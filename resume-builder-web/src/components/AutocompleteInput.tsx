'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type AutocompleteInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (value: string) => void;
  fetchSuggestions?: (query: string) => Promise<string[]>;
  localSuggestions?: string[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  allowCustom?: boolean;
  debounceMs?: number;
  testId?: string;
};

export function AutocompleteInput({
  value,
  onChange,
  onSelect,
  fetchSuggestions,
  localSuggestions = [],
  placeholder = '',
  className = 'input',
  disabled = false,
  allowCustom = true,
  debounceMs = 250,
  testId,
}: AutocompleteInputProps) {
  const [open, setOpen] = useState(false);
  const [remoteSuggestions, setRemoteSuggestions] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mergedSuggestions = useMemo(
    () => buildAutocompleteSuggestions({ query: value, local: localSuggestions, remote: remoteSuggestions }).slice(0, 10),
    [localSuggestions, remoteSuggestions, value],
  );

  useEffect(() => {
    if (!fetchSuggestions) return;
    const query = String(value || '').trim();
    if (!query) {
      setRemoteSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchSuggestions(query)
        .then((items) => {
          if (cancelled) return;
          setRemoteSuggestions(Array.isArray(items) ? items : []);
        })
        .catch(() => {
          if (cancelled) return;
          setRemoteSuggestions([]);
        });
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [debounceMs, fetchSuggestions, value]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  function commitSelection(nextValue: string) {
    const clean = String(nextValue || '').trim();
    if (!clean && !allowCustom) return;
    onChange(clean);
    if (clean) onSelect?.(clean);
    setOpen(false);
    setActiveIndex(-1);
  }

  return (
    <div className="autocomplete-input" data-testid={testId}>
      <input
        className={className}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={testId ? `${testId}-listbox` : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          closeTimerRef.current = setTimeout(() => setOpen(false), 120);
        }}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            setActiveIndex(-1);
            return;
          }
          if (!mergedSuggestions.length) {
            if (event.key === 'Enter' && allowCustom) {
              commitSelection(value);
            }
            return;
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((prev) => {
              if (event.key === 'ArrowDown') {
                if (prev < 0) return 0;
                return (prev + 1) % mergedSuggestions.length;
              }
              if (prev < 0) return mergedSuggestions.length - 1;
              return (prev - 1 + mergedSuggestions.length) % mergedSuggestions.length;
            });
            return;
          }
          if (event.key === 'Enter') {
            if (activeIndex >= 0 && mergedSuggestions[activeIndex]) {
              event.preventDefault();
              commitSelection(mergedSuggestions[activeIndex]);
              return;
            }
            if (allowCustom) {
              commitSelection(value);
            }
          }
        }}
      />
      {open && mergedSuggestions.length > 0 && (
        <ul
          className="autocomplete-input__menu"
          role="listbox"
          id={testId ? `${testId}-listbox` : undefined}
        >
          {mergedSuggestions.map((suggestion, index) => (
            <li
              key={`${suggestion}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`autocomplete-input__item${index === activeIndex ? ' active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commitSelection(suggestion)}
            >
              {suggestion}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function buildAutocompleteSuggestions(input: { query: string; local: string[]; remote: string[] }) {
  const query = normalize(input.query);
  const merged = dedupe([...input.local, ...input.remote]);
  if (!query) return merged;
  return merged
    .map((item) => ({ item, score: score(item, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.item.localeCompare(b.item);
    })
    .map((entry) => entry.item);
}

export function selectAutocompleteValue(input: {
  suggestions: string[];
  activeIndex: number;
  typedValue: string;
  allowCustom?: boolean;
}) {
  if (input.activeIndex >= 0 && input.suggestions[input.activeIndex]) {
    return input.suggestions[input.activeIndex];
  }
  if (input.allowCustom === false) return '';
  return String(input.typedValue || '').trim();
}

function score(value: string, query: string) {
  const normalizedValue = normalize(value);
  if (!normalizedValue) return 0;
  if (normalizedValue.startsWith(query)) return 300;
  if (normalizedValue.includes(query)) return 200;
  const queryTokens = tokenize(query);
  const valueTokens = tokenize(normalizedValue);
  const overlap = queryTokens.filter((token) => valueTokens.some((valueToken) => valueToken.includes(token))).length;
  if (overlap > 0) return 100 + overlap;
  return 0;
}

function normalize(value: string) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value: string) {
  return normalize(value).split(/[\s-]+/).filter(Boolean);
}

function dedupe(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values || []) {
    const clean = String(value || '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }
  return output;
}
