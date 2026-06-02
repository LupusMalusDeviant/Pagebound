using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;

namespace Pagebound.Infrastructure.Pdf;

/// <summary>
/// <see cref="IBatchRuleStore"/> auf Basis von <see cref="IStorageService"/>
/// (IndexedDB). Jede Regel liegt unter <c>batch:rule:{id}</c> als JSON.
/// Kein Server, kein Netzwerk (FA-052). Spiegelt das Muster von
/// <c>EditorDraftService</c>.
/// </summary>
public sealed class BatchRuleStore : IBatchRuleStore
{
    private const string KeyPrefix = "batch:rule:";

    private readonly IStorageService _storage;

    public BatchRuleStore(IStorageService storage)
    {
        _storage = storage ?? throw new ArgumentNullException(nameof(storage));
    }

    private static string KeyFor(string id) => KeyPrefix + id;

    public async Task<IReadOnlyList<BatchRule>> ListAsync(CancellationToken cancellationToken)
    {
        var rules = new List<BatchRule>();
        await foreach (var key in _storage.KeysAsync(KeyPrefix, cancellationToken).ConfigureAwait(false))
        {
            var rule = await _storage.GetAsync<BatchRule>(key, cancellationToken).ConfigureAwait(false);
            if (rule is not null)
            {
                rules.Add(rule);
            }
        }
        return rules.OrderByDescending(r => r.UpdatedAt).ToList();
    }

    public Task SaveAsync(BatchRule rule, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(rule);
        if (string.IsNullOrEmpty(rule.Id))
        {
            rule.Id = Guid.NewGuid().ToString("N");
        }
        rule.UpdatedAt = DateTimeOffset.UtcNow;
        return _storage.SetAsync(KeyFor(rule.Id), rule, cancellationToken);
    }

    public Task DeleteAsync(string id, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(id);
        return _storage.DeleteAsync(KeyFor(id), cancellationToken);
    }
}
