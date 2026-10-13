using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace GuessNumber.Server.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : IdentityDbContext<AppUser>(options)
{
    public DbSet<GameEntity> Games => Set<GameEntity>();
    public DbSet<MoveEntity> Moves => Set<MoveEntity>();
    public DbSet<ChatMessageEntity> ChatMessages => Set<ChatMessageEntity>();
    public DbSet<UserSettingsEntity> PlayerSettings => Set<UserSettingsEntity>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.Entity<GameEntity>().HasMany(g => g.Moves).WithOne(m => m.Game!).HasForeignKey(m => m.GameId);
        builder.Entity<GameEntity>().HasMany(g => g.Chat).WithOne(c => c.Game!).HasForeignKey(c => c.GameId);
        builder.Entity<UserSettingsEntity>().HasKey(s => s.UserId);
        builder.Entity<MoveEntity>().Property(m => m.Kind).HasMaxLength(16);
    }
}
