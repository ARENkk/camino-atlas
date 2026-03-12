import React from 'react';

type Props = {
  count: number;
};

export const ShellIcon: React.FC<Props> = ({ count }) => {
  const safeCount = Math.min(5, Math.max(1, count || 1));
  return (
    <span className="shellIcons" aria-label={`difficulty-${safeCount}`}>
      {Array.from({ length: safeCount }).map((_, index) => (
        <svg
          key={index}
          className="shellSvg"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M12 4.2c-4.7 0-8.5 3.6-8.5 8.2 0 3.1 2.1 5.5 5.1 6.4l.4.1 1.7-6.5-2.6 2.2a.8.8 0 0 1-1.1-1.2l4.4-3.8c.5-.4 1.2 0 1 .7l-2 7.8h3.2l-2-7.8c-.1-.7.6-1.1 1.1-.7l4.3 3.8a.8.8 0 0 1-1 1.2l-2.6-2.2 1.7 6.5.4-.1c3-.9 5.1-3.3 5.1-6.4 0-4.6-3.8-8.2-8.6-8.2z"
          />
        </svg>
      ))}
    </span>
  );
};

