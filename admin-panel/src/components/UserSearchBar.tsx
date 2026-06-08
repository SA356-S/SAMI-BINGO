import { FormEvent } from 'react';
import { Search } from 'lucide-react';

interface UserSearchBarProps {
  query: string;
  loading: boolean;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
}

export default function UserSearchBar({
  query,
  loading,
  onQueryChange,
  onSearch,
}: UserSearchBarProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSearch();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
      <label className="sr-only" htmlFor="user-search">
        Search by username or phone
      </label>
      <input
        id="user-search"
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search by @username or phone number"
        className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400/40 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        autoComplete="off"
      />
      <button
        type="submit"
        disabled={loading || !query.trim()}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-400/30 bg-indigo-500/20 px-5 py-3 text-sm font-bold text-indigo-100 transition hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Search className="h-4 w-4" />
        {loading ? 'Searching…' : 'Search User'}
      </button>
    </form>
  );
}
