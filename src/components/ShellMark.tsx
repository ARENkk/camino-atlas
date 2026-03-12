import React from 'react';

type Props = {
  className?: string;
  size?: number;
};

export function ShellIconRounded({ size = 12, className = '' }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12 5.1
           C8.7 5.1 6.1 6.8 5 9.7
           C4 12.5 4.8 15.8 7 17.6
           C8.2 18.6 9.8 19.1 12 19.1
           C14.2 19.1 15.8 18.6 17 17.6
           C19.2 15.8 20 12.5 19 9.7
           C17.9 6.8 15.3 5.1 12 5.1
           Z"
        fill="currentColor"
      />
      <path
        d="M12 7L12 17.8"
        stroke="rgba(9,18,34,0.15)"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M8.9 7.9L10.4 17.2"
        stroke="rgba(9,18,34,0.12)"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M15.1 7.9L13.6 17.2"
        stroke="rgba(9,18,34,0.12)"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M6.9 10.1L9.5 16.5"
        stroke="rgba(9,18,34,0.08)"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M17.1 10.1L14.5 16.5"
        stroke="rgba(9,18,34,0.08)"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Backward-compatible alias for existing imports.
export const ShellMark = ShellIconRounded;
