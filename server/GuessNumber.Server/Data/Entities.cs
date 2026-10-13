using Microsoft.AspNetCore.Identity;

namespace GuessNumber.Server.Data;

public sealed class AppUser : IdentityUser
{
    public string DisplayName { get; set; } = "";
}

public sealed class GameEntity
{
    public Guid Id { get; set; }
    public string SettingsJson { get; set; } = "";
    public string Status { get; set; } = "";
    public string Player0Id { get; set; } = "";
    public string? Player1Id { get; set; }
    public string? Secret0Protected { get; set; }
    public string? Secret1Protected { get; set; }
    public string? SecretHistoryProtected { get; set; }
    public int Score0 { get; set; }
    public int Score1 { get; set; }
    public int Turn { get; set; }
    public int CurrentPlayer { get; set; }
    public string? WinnerId { get; set; }
    public int SolverSeed { get; set; }
    public DateTimeOffset CreatedUtc { get; set; }
    public List<MoveEntity> Moves { get; set; } = [];
    public List<ChatMessageEntity> Chat { get; set; } = [];
}

public sealed class MoveEntity
{
    public int Id { get; set; }
    public Guid GameId { get; set; }
    public GameEntity? Game { get; set; }
    public int Turn { get; set; }
    public int Player { get; set; }
    public string Kind { get; set; } = "";
    public string? Guess { get; set; }
    public int? Dead { get; set; }
    public int? Wounded { get; set; }
    public int PointsDelta { get; set; }
    public bool RevisitedPreviousSecret { get; set; }
}

public sealed class ChatMessageEntity
{
    public int Id { get; set; }
    public Guid GameId { get; set; }
    public GameEntity? Game { get; set; }
    public string UserId { get; set; } = "";
    public string Text { get; set; } = "";
    public DateTimeOffset SentAt { get; set; }
}

public sealed class UserSettingsEntity
{
    public string UserId { get; set; } = "";
    public string SettingsJson { get; set; } = "";
}
