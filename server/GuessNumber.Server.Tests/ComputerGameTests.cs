using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GuessNumber.Engine;
using GuessNumber.Server.Data;
using GuessNumber.Server.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace GuessNumber.Server.Tests;

public sealed class ComputerGameTests : IAsyncLifetime
{
    private readonly GameAppFactory _factory = new();
    private HttpClient _client = null!;

    public Task InitializeAsync()
    {
        _client = _factory.CreateClient();
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    [Fact]
    public async Task Full_game_against_the_computer_keeps_secrets_on_the_server()
    {
        var email = $"player-{Guid.NewGuid():N}@example.com";
        var registered = await _client.PostAsJsonAsync("/api/auth/register", new { email, password = "password1", displayName = "Ada" });
        registered.EnsureSuccessStatusCode();
        var loggedIn = await _client.PostAsJsonAsync("/api/auth/login", new { email, password = "password1" });
        loggedIn.EnsureSuccessStatusCode();
        var token = (await loggedIn.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        Assert.False(string.IsNullOrWhiteSpace(token));

        await using var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(_client.BaseAddress!, "/hubs/game"), options =>
            {
                options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                options.AccessTokenProvider = () => Task.FromResult<string?>(token);
            })
            .Build();
        await connection.StartAsync();

        var created = await connection.InvokeAsync<GameSnapshot>("CreateGame", new GameSettingsDto
        {
            TurnTimerSec = 0,
            Opponent = new OpponentDto { Kind = "computer", Agent = "swor", Per = false, ChangePolicy = "never" }
        });
        Assert.Equal("AwaitingSecrets", created.State.Phase);

        const string secret = "1234";
        var started = await connection.InvokeAsync<GameSnapshot>("SetSecret", secret);
        Assert.Equal("InProgress", started.State.Phase);
        Assert.Equal(0, started.State.CurrentPlayer);

        var codes = Ruleset.Classic4.AllCodes;
        var random = new Random(3);
        var latest = started;
        for (var turn = 0; turn < 25 && latest.State.Phase != "Finished"; turn++)
        {
            latest = await connection.InvokeAsync<GameSnapshot>("SubmitGuess", codes[random.Next(codes.Count)]);
        }

        Assert.Equal("Finished", latest.State.Phase);
        var payload = JsonSerializer.Serialize(latest);
        Assert.DoesNotContain("\"secrets\"", payload, StringComparison.OrdinalIgnoreCase);

        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var protector = scope.ServiceProvider.GetRequiredService<SecretProtector>();
        var entity = await db.Games.Include(game => game.Moves).SingleAsync();
        Assert.NotEqual(secret, entity.Secret0Protected);
        Assert.Equal(secret, protector.Unprotect(entity.Secret0Protected!));
        Assert.NotEqual(protector.Unprotect(entity.Secret1Protected!), entity.Secret1Protected);
        Assert.Contains(entity.Moves, move => move.Player == 1 && move.Kind == "guess");
        Assert.Equal("Finished", entity.Status);

        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var record = await _client.GetFromJsonAsync<JsonElement>("/api/record");
        var opponents = record.GetProperty("opponents");
        Assert.Equal(1, opponents.GetArrayLength());
        Assert.Equal("computer:swor:false", opponents[0].GetProperty("key").GetString());
        Assert.Equal("Sampling without replacement", opponents[0].GetProperty("name").GetString());
        Assert.Equal(1, opponents[0].GetProperty("won").GetInt32() + opponents[0].GetProperty("lost").GetInt32());
    }
}

public sealed class GameAppFactory : WebApplicationFactory<Program>
{
    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"gn-{Guid.NewGuid():N}.db");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("Database:Provider", "Sqlite");
        builder.UseSetting("Database:Sqlite", "Data Source=" + _dbPath);
        builder.UseSetting("Jwt:Key", "test-signing-key-at-least-32-bytes!");
        builder.UseSetting("ConnectionStrings:Redis", "");
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        try
        {
            if (File.Exists(_dbPath))
                File.Delete(_dbPath);
        }
        catch (IOException)
        {
            // The test host may still be releasing the file.
        }
    }
}
