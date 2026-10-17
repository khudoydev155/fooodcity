import React from 'react';

/**
 * Click rasmiy logotipi (vektor SVG)
 */
export function ClickLogo({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Click logo"
    >
      <defs>
        <linearGradient id="clickGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00C462" />
          <stop offset="100%" stopColor="#00994C" />
        </linearGradient>
      </defs>
      {/* Asosiy yashil squircle */}
      <rect width="44" height="44" rx="12" fill="url(#clickGrad)" />
      <rect x="0.5" y="0.5" width="43" height="43" rx="11.5" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
      {/* Click logotipi: "click" yozuvi va sariq nuqta */}
      <g transform="translate(4, 13)">
        {/* c */}
        <path
          d="M7.8 11.5C6 11.5 4.5 10.2 4.5 8C4.5 5.8 6 4.5 7.8 4.5C9.2 4.5 10.2 5.3 10.5 6.5H8.7C8.5 5.9 8.2 5.7 7.8 5.7C6.8 5.7 6.1 6.6 6.1 8C6.1 9.4 6.8 10.3 7.8 10.3C8.2 10.3 8.5 10.1 8.7 9.5H10.5C10.2 10.7 9.2 11.5 7.8 11.5Z"
          fill="#FFFFFF"
        />
        {/* l */}
        <path d="M12 1.5H13.6V11.3H12V1.5Z" fill="#FFFFFF" />
        {/* i */}
        <path d="M15.5 4.7H17.1V11.3H15.5V4.7Z" fill="#FFFFFF" />
        <circle cx="16.3" cy="2.5" r="1.1" fill="#FFE600" />
        {/* c */}
        <path
          d="M21.3 11.5C19.5 11.5 18 10.2 18 8C18 5.8 19.5 4.5 21.3 4.5C22.7 4.5 23.7 5.3 24 6.5H22.2C22 5.9 21.7 5.7 21.3 5.7C20.3 5.7 19.6 6.6 19.6 8C19.6 9.4 20.3 10.3 21.3 10.3C21.7 10.3 22 10.1 22.2 9.5H24C23.7 10.7 22.7 11.5 21.3 11.5Z"
          fill="#FFFFFF"
        />
        {/* k */}
        <path
          d="M25.5 1.5H27.1V7.1L29.6 4.7H31.7L28.8 7.6L32 11.3H29.8L27.1 8.2V11.3H25.5V1.5Z"
          fill="#FFFFFF"
        />
      </g>
    </svg>
  );
}

/**
 * Payme rasmiy logotipi (vektor SVG)
 */
export function PaymeLogo({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Payme logo"
    >
      <defs>
        <linearGradient id="paymeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#14E5ED" />
          <stop offset="100%" stopColor="#00A8AF" />
        </linearGradient>
      </defs>
      {/* Asosiy firuza/cyan squircle */}
      <rect width="44" height="44" rx="12" fill="url(#paymeGrad)" />
      <rect x="0.5" y="0.5" width="43" height="43" rx="11.5" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
      {/* Payme logotipi: "payme" yozuvi */}
      <g transform="translate(3, 14.5)">
        {/* p */}
        <path
          d="M4 3H6.8C8.5 3 9.8 4.1 9.8 5.7C9.8 7.3 8.5 8.4 6.8 8.4H5.6V12H4V3ZM5.6 7H6.7C7.6 7 8.2 6.5 8.2 5.7C8.2 4.9 7.6 4.4 6.7 4.4H5.6V7Z"
          fill="#FFFFFF"
        />
        {/* a */}
        <path
          d="M14 6.5V12H12.5V10.9C12 11.7 11 12.1 10.1 12.1C8.7 12.1 7.6 11.2 7.6 9.8C7.6 8.3 8.9 7.6 10.4 7.6H12.4V7.2C12.4 6.3 11.7 5.8 10.7 5.8C9.9 5.8 9.2 6.1 9 6.7H7.6C7.9 5.3 9.1 4.5 10.8 4.5C12.8 4.5 14 5.3 14 6.5ZM12.4 8.7H10.6C9.6 8.7 9 9.1 9 9.8C9 10.5 9.6 11 10.4 11C11.5 11 12.4 10.1 12.4 9.1V8.7Z"
          fill="#FFFFFF"
        />
        {/* y */}
        <path
          d="M15 4.7H16.6L18.1 9.4L19.6 4.7H21.2L18.8 11.8C18.2 13.5 17.3 14.3 15.6 14.3H14.8V13.1H15.4C16.3 13.1 16.8 12.7 17.2 11.6L15 4.7Z"
          fill="#FFFFFF"
        />
        {/* m */}
        <path
          d="M22.5 4.7H24V5.8C24.5 5.1 25.3 4.5 26.3 4.5C27.3 4.5 28 5 28.3 5.9C28.9 5 29.8 4.5 30.8 4.5C32.3 4.5 33.1 5.5 33.1 7.1V12H31.6V7.3C31.6 6.3 31.1 5.7 30.2 5.7C29.4 5.7 28.7 6.4 28.7 7.4V12H27.2V7.3C27.2 6.3 26.7 5.7 25.8 5.7C25 5.7 24.3 6.4 24.3 7.4V12H22.5V4.7Z"
          fill="#FFFFFF"
        />
        {/* e */}
        <path
          d="M37.5 8.7H34.7C34.9 9.9 35.8 10.7 36.9 10.7C37.7 10.7 38.3 10.3 38.5 9.8H39.8C39.4 11.2 38.3 12 36.8 12C35 12 33.5 10.6 33.5 8.3C33.5 6 34.9 4.6 36.8 4.6C38.6 4.6 39.8 5.9 39.8 8.1V8.7H37.5ZM37.5 7.6C37.4 6.5 36.6 5.8 35.7 5.8C34.9 5.8 34.2 6.5 34 7.6H37.5Z"
          fill="#FFFFFF"
        />
      </g>
    </svg>
  );
}

/**
 * Naqd pul (Cash) chiroyli vektor belgisi
 */
export function CashLogo({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Naqd pul"
    >
      <defs>
        <linearGradient id="cashGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFB800" />
          <stop offset="100%" stopColor="#E69500" />
        </linearGradient>
      </defs>
      <rect width="44" height="44" rx="12" fill="url(#cashGrad)" />
      <rect x="0.5" y="0.5" width="43" height="43" rx="11.5" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
      {/* Banknota va tangalar vektori */}
      <rect x="9.5" y="14" width="25" height="16" rx="3.5" stroke="#FFFFFF" strokeWidth="2.2" fill="none" />
      <circle cx="22" cy="22" r="3.8" stroke="#FFFFFF" strokeWidth="2.2" fill="none" />
      <path d="M12.5 18H14M30 26H31.5" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
