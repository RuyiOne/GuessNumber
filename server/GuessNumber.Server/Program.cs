using System.Text;
using System.Text.Json;
using GuessNumber.Server.Data;
using GuessNumber.Server.Hubs;
using GuessNumber.Server.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

var jwtKey = Environment.GetEnvironmentVariable("JWT_SIGNING_KEY")
    ?? builder.Configuration["Jwt:Key"];
if (string.IsNullOrWhiteSpace(jwtKey))
{
    if (builder.Environment.IsDevelopment() || builder.Environment.IsEnvironment("Testing"))
        jwtKey = "dev-only-signing-key-not-for-production!!";
    else
        throw new InvalidOperationException("Set Jwt:Key or the JWT_SIGNING_KEY environment variable.");
}

var dbProvider = builder.Configuration["Database:Provider"] ?? "Sqlite";
builder.Services.AddDbContext<AppDbContext>(options =>
{
    if (dbProvider.Equals("Postgres", StringComparison.OrdinalIgnoreCase))
        options.UseNpgsql(builder.Configuration.GetConnectionString("Postgres"));
    else
        options.UseSqlite(builder.Configuration["Database:Sqlite"] ?? "Data Source=guessnumber.db");
});

builder.Services.AddIdentityCore<AppUser>(options =>
    {
        options.Password.RequiredLength = 8;
        options.Password.RequireNonAlphanumeric = false;
        options.Password.RequireUppercase = false;
        options.User.RequireUniqueEmail = true;
    })
    .AddEntityFrameworkStores<AppDbContext>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"] ?? "guessnumber",
            ValidAudience = builder.Configuration["Jwt:Audience"] ?? "guessnumber",
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            NameClaimType = "sub"
        };
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(accessToken) && context.HttpContext.Request.Path.StartsWithSegments("/hubs/game"))
                    context.Token = accessToken;
                return Task.CompletedTask;
            }
        };
    });
builder.Services.AddAuthorization();

var redis = builder.Configuration.GetConnectionString("Redis");
if (!string.IsNullOrWhiteSpace(redis))
{
    builder.Services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(redis));
    builder.Services.AddSingleton<IPresence, RedisPresence>();
}
else
{
    builder.Services.AddSingleton<IPresence, MemoryPresence>();
}

var signalr = builder.Services.AddSignalR();
if (!string.IsNullOrWhiteSpace(redis))
    signalr.AddStackExchangeRedis(redis);
signalr.AddJsonProtocol(options =>
{
    options.PayloadSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
});

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy => policy
        .WithOrigins("http://localhost:5173", "http://localhost:8081")
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});

builder.Services.AddDataProtection();
builder.Services.AddSingleton<SecretProtector>();
builder.Services.AddSingleton<LiveGames>();
builder.Services.AddSingleton<LobbyQueue>();
builder.Services.AddScoped<GameRepository>();

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
}

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapPost("/api/auth/register", async (RegisterRequest request, UserManager<AppUser> users) =>
{
    var user = new AppUser { UserName = request.Email, Email = request.Email, DisplayName = request.DisplayName };
    var result = await users.CreateAsync(user, request.Password);
    if (!result.Succeeded)
        return Results.BadRequest(result.Errors.Select(error => error.Code));
    return Results.Ok(new { user.Id, user.DisplayName });
});

app.MapPost("/api/auth/login", async (LoginRequest request, UserManager<AppUser> users) =>
{
    var user = await users.FindByEmailAsync(request.Email);
    if (user is null || !await users.CheckPasswordAsync(user, request.Password))
        return Results.Unauthorized();
    var token = JwtToken.Create(user, jwtKey, builder.Configuration["Jwt:Issuer"] ?? "guessnumber", builder.Configuration["Jwt:Audience"] ?? "guessnumber");
    return Results.Ok(new { token, user.DisplayName });
});

app.MapGet("/api/record", async (HttpContext http, AppDbContext db) =>
{
    var userId = http.User.FindFirst("sub")?.Value;
    if (userId is null)
        return Results.Unauthorized();

    var games = await db.Games.AsNoTracking()
        .Where(game => game.Status == "Finished" && (game.Player0Id == userId || game.Player1Id == userId))
        .Select(game => new { game.Player0Id, game.Player1Id, game.WinnerId, game.SettingsJson })
        .ToListAsync();

    var totals = new Dictionary<string, (string Name, int Won, int Lost)>(StringComparer.Ordinal);
    foreach (var game in games)
    {
        if (game.WinnerId is null)
            continue;

        var opponentId = game.Player0Id == userId ? game.Player1Id : game.Player0Id;
        var (key, name) = OpponentLabels.Describe(game.SettingsJson, opponentId);
        if (opponentId is not null && opponentId != "computer")
        {
            var person = await db.Users.AsNoTracking().FirstOrDefaultAsync(user => user.Id == opponentId);
            if (!string.IsNullOrWhiteSpace(person?.DisplayName))
                name = person.DisplayName;
        }

        totals.TryGetValue(key, out var row);
        var won = game.WinnerId == userId;
        totals[key] = (string.IsNullOrEmpty(row.Name) ? name : row.Name, row.Won + (won ? 1 : 0), row.Lost + (won ? 0 : 1));
    }

    var opponents = totals
        .OrderBy(pair => pair.Value.Name, StringComparer.CurrentCultureIgnoreCase)
        .Select(pair => new { key = pair.Key, name = pair.Value.Name, won = pair.Value.Won, lost = pair.Value.Lost });
    return Results.Ok(new { opponents });
}).RequireAuthorization();

app.MapGet("/api/history", async (HttpContext http, AppDbContext db) =>
{
    var userId = http.User.FindFirst("sub")?.Value;
    if (userId is null)
        return Results.Unauthorized();
    var games = await db.Games.AsNoTracking()
        .Where(game => game.Player0Id == userId || game.Player1Id == userId)
        .OrderByDescending(game => game.CreatedUtc)
        .Select(game => new { game.Id, game.Status, game.Score0, game.Score1, game.WinnerId, game.CreatedUtc })
        .ToListAsync();
    return Results.Ok(games);
}).RequireAuthorization();

app.MapGet("/api/settings", async (HttpContext http, AppDbContext db) =>
{
    var userId = http.User.FindFirst("sub")?.Value ?? "";
    var row = await db.PlayerSettings.FindAsync(userId);
    return Results.Ok(new { settings = row?.SettingsJson ?? "" });
}).RequireAuthorization();

app.MapPut("/api/settings", async (SettingsRequest request, HttpContext http, AppDbContext db) =>
{
    var userId = http.User.FindFirst("sub")?.Value ?? "";
    var row = await db.PlayerSettings.FindAsync(userId);
    if (row is null)
    {
        row = new UserSettingsEntity { UserId = userId };
        db.PlayerSettings.Add(row);
    }

    row.SettingsJson = request.SettingsJson;
    await db.SaveChangesAsync();
    return Results.Ok();
}).RequireAuthorization();

app.MapHub<GameHub>("/hubs/game");
app.Run();

public partial class Program;

public sealed record RegisterRequest(string Email, string Password, string DisplayName);
public sealed record LoginRequest(string Email, string Password);
public sealed record SettingsRequest(string SettingsJson);

public static class OpponentLabels
{
    public static (string Key, string Name) Describe(string settingsJson, string? opponentId)
    {
        if (opponentId == "computer")
        {
            var agent = "swor";
            var per = false;
            try
            {
                using var document = JsonDocument.Parse(string.IsNullOrWhiteSpace(settingsJson) ? "{}" : settingsJson);
                if (document.RootElement.TryGetProperty("opponent", out var opponent))
                {
                    if (opponent.TryGetProperty("agent", out var agentValue) && agentValue.GetString() is { Length: > 0 } stored)
                        agent = stored;
                    if (opponent.TryGetProperty("per", out var perValue) && perValue.ValueKind is JsonValueKind.True or JsonValueKind.False)
                        per = perValue.GetBoolean();
                }
            }
            catch (JsonException)
            {
                agent = "swor";
            }

            return ($"computer:{agent}:{per.ToString().ToLowerInvariant()}", Label(agent, per));
        }

        return ($"player:{opponentId}", "Another player");
    }

    private static string Label(string agent, bool per)
    {
        var name = agent switch
        {
            "dqn" => "DQN",
            "double" => "Double DQN",
            "duelling" => "Duelling DQN",
            "doubleDuelling" => "Double + Duelling",
            _ => "Sampling without replacement"
        };
        return per ? $"{name}, prioritised replay" : name;
    }
}

public static class JwtToken
{
    public static string Create(AppUser user, string key, string issuer, string audience)
    {
        var claims = new[]
        {
            new System.Security.Claims.Claim("sub", user.Id),
            new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.NameIdentifier, user.Id),
            new System.Security.Claims.Claim("name", user.DisplayName)
        };
        var credentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)), SecurityAlgorithms.HmacSha256);
        var token = new System.IdentityModel.Tokens.Jwt.JwtSecurityToken(issuer, audience, claims, expires: DateTime.UtcNow.AddDays(7), signingCredentials: credentials);
        return new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().WriteToken(token);
    }
}
