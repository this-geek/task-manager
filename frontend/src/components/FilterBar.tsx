interface Props {
  assignees: string[];
  categories: string[];
  tags: string[];
  assignee: string;
  category: string;
  selectedTags: string[];
  aiMode: boolean;
  onAssigneeChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onToggleTag: (tag: string) => void;
  onToggleAiMode: () => void;
}

export function FilterBar({
  assignees,
  categories,
  tags,
  assignee,
  category,
  selectedTags,
  aiMode,
  onAssigneeChange,
  onCategoryChange,
  onToggleTag,
  onToggleAiMode,
}: Props) {
  return (
    <div className="filter-bar">
      <select aria-label="Filter by assignee" value={assignee} onChange={(e) => onAssigneeChange(e.target.value)}>
        <option value="">All assignees</option>
        {assignees.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>

      <select aria-label="Filter by category" value={category} onChange={(e) => onCategoryChange(e.target.value)}>
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      {tags.map((tag) => (
        <button
          key={tag}
          type="button"
          className={selectedTags.includes(tag) ? 'active' : ''}
          style={
            selectedTags.includes(tag) ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-contrast)' } : undefined
          }
          onClick={() => onToggleTag(tag)}
        >
          #{tag}
        </button>
      ))}

      <div className="ai-toggle">
        <button type="button" className={aiMode ? 'active' : ''} onClick={onToggleAiMode} title="Mirrors GET /api/agent/actionable">
          🤖 AI Target Mode
        </button>
      </div>
    </div>
  );
}
