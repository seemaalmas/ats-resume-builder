'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  advanceSuggestionIndex,
  buildCompanySuggestions,
  selectSuggestionAtIndex,
} from '@/src/lib/company-suggestions';

type CompanyAutocompleteProps = {
  value: string;
  suggestions: string[];
  onChange: (value: string) => void;
  onSelect?: (value: string) => void;
  fetchSuggestions?: (query: string) => Promise<string[]>;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  testId?: string;
};

const REMOTE_LOOKUP_MIN_QUERY = 2;

export function CompanyAutocomplete({
  value,
  suggestions,
  onChange,
  onSelect,
  fetchSuggestions,
  placeholder = 'Company',
  className = 'input',
  disabled = false,
  testId,
}: CompanyAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [remoteSuggestions, setRemoteSuggestions] = useState<string[]>([]);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = String(value || '').trim();
  const allSuggestions = useMemo(
    () => buildCompanySuggestions({
      query,
      localCompanies: suggestions,
      remoteCompanies: remoteSuggestions,
      limit: 10,
    }),
    [query, remoteSuggestions, suggestions],
  );

  useEffect(() => {
    if (!fetchSuggestions) return;
    if (query.length < REMOTE_LOOKUP_MIN_QUERY) {
      setRemoteSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchSuggestions(query)
        .then((result) => {
          if (cancelled) return;
          setRemoteSuggestions(Array.isArray(result) ? result : []);
        })
        .catch(() => {
          if (cancelled) return;
          setRemoteSuggestions([]);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetchSuggestions, query]);

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1);
      return;
    }
    if (activeIndex >= allSuggestions.length) {
      setActiveIndex(allSuggestions.length ? 0 : -1);
    }
  }, [activeIndex, allSuggestions.length, open]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  function selectSuggestion(value: string) {
    const picked = String(value || '').trim();
    if (!picked) return;
    onChange(picked);
    onSelect?.(picked);
    setOpen(false);
    setActiveIndex(-1);
  }

  return (
    <div className="company-autocomplete" data-testid={testId}>
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
          if (!allSuggestions.length) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            const direction = event.key === 'ArrowDown' ? 'ArrowDown' : 'ArrowUp';
            setActiveIndex((prev) => advanceSuggestionIndex(prev, direction, allSuggestions.length));
            return;
          }
          if (event.key === 'Enter') {
            if (!open || activeIndex < 0) return;
            event.preventDefault();
            const picked = selectSuggestionAtIndex(allSuggestions, activeIndex);
            selectSuggestion(picked);
            return;
          }
          if (event.key === 'Escape') {
            setOpen(false);
            setActiveIndex(-1);
          }
        }}
      />
      {open && allSuggestions.length > 0 && (
        <ul
          className="company-autocomplete__menu"
          role="listbox"
          id={testId ? `${testId}-listbox` : undefined}
        >
          {allSuggestions.map((suggestion, index) => (
            <li
              key={`${suggestion}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`company-autocomplete__item${index === activeIndex ? ' active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectSuggestion(suggestion)}
            >
              {suggestion}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
