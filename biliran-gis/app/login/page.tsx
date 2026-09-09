// src/app/login/page.tsx
//
// Login screen — bird's-eye view of Biliran island, game-menu style.
// - The whole scene (island + sea) slowly drifts toward a corner and eases
//   back, so it *feels* like it's drifting while staying framed in the
//   middle. The target corner is derived from the real hour (getHours() % 4),
//   which naturally changes every 60 minutes without needing a persisted
//   timer — TL -> TR -> BR -> BL -> repeat.
// - Clouds and birds drift independently of that, on their own loops.
// - Light mode = sunny day sky. Dark mode = night sky with moon + stars.
//   Defaults to system preference (prefers-color-scheme), with a manual
//   sun/moon toggle in the corner.
// - Logo sits centered, just above the form. Place the two PNGs shipped
//   alongside this file at: public/logo-light.png, public/logo-dark.png

'use client'

import { useEffect, useState, useCallback, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const CORNERS = [
  { x: -1, y: -1 }, // top-left
  { x: 1, y: -1 }, // top-right
  { x: 1, y: 1 }, // bottom-right
  { x: -1, y: 1 }, // bottom-left
]

function getCornerIndex() {
  return new Date().getHours() % 4
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [cornerIndex, setCornerIndex] = useState(0)

  // Follow system theme on mount, then let the manual toggle take over.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setTheme(mq.matches ? 'dark' : 'light')
    const listener = (e: MediaQueryListEvent) =>
      setTheme(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [])

  // Drift direction changes every 60 minutes, on the hour boundary.
  useEffect(() => {
    setCornerIndex(getCornerIndex())
    const id = setInterval(() => setCornerIndex(getCornerIndex()), 30_000)
    return () => clearInterval(id)
  }, [])

  const corner = CORNERS[cornerIndex]

  const emailValid = /\S+@\S+\.\S+/.test(email)
  const passwordValid = password.length >= 6

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setError(null)
      setLoading(true)
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      setLoading(false)
      if (authError) {
        setError('Email or password is incorrect. Try again.')
        return
      }
      router.push('/dashboard')
    },
    [email, password, router]
  )

  return (
    <div
      data-theme={theme}
      className="bfw-root relative min-h-screen w-full overflow-hidden"
      style={
        {
          '--drift-x': `${corner.x * 22}px`,
          '--drift-y': `${corner.y * 16}px`,
        } as React.CSSProperties
      }
    >
      <style>{`
        .bfw-root[data-theme='light'] {
          --sky-top: #6EC6E8;
          --sky-bottom: #DCEFF5;
          --sea-top: #1E7F8C;
          --sea-bottom: #58C2C9;
          --land: #6FA85B;
          --land-dark: #4F8A45;
          --contour: #3E7038;
          --mountain: #8C7355;
          --sun-glow: rgba(253, 200, 90, 0.55);
          --sun-core: #FFD873;
          --cloud: rgba(255, 255, 255, 0.9);
          --bird: rgba(30, 40, 40, 0.65);
          --card-bg: rgba(255, 255, 255, 0.72);
          --card-border: rgba(255, 255, 255, 0.5);
          --text-strong: #0B3654;
          --text-soft: #3E6664;
          --field-line: #C9DEDA;
        }
        .bfw-root[data-theme='dark'] {
          --sky-top: #0B1830;
          --sky-bottom: #1B2C46;
          --sea-top: #0B3038;
          --sea-bottom: #114652;
          --land: #33502F;
          --land-dark: #24391F;
          --contour: #1B2E17;
          --mountain: #4A4038;
          --sun-glow: rgba(230, 235, 255, 0.18);
          --sun-core: #EDEFF7;
          --cloud: rgba(210, 220, 235, 0.35);
          --bird: rgba(230, 235, 245, 0.55);
          --card-bg: rgba(11, 24, 40, 0.6);
          --card-border: rgba(255, 255, 255, 0.12);
          --text-strong: #F2F6F5;
          --text-soft: #A9C0C6;
          --field-line: rgba(255, 255, 255, 0.2);
        }

        .bfw-sky {
          position: absolute;
          inset: 0;
          background: linear-gradient(to bottom, var(--sky-top), var(--sky-bottom));
          transition: background 1.2s ease;
        }
        .bfw-stars {
          position: absolute;
          inset: 0;
          opacity: 0;
          transition: opacity 1.2s ease;
        }
        .bfw-root[data-theme='dark'] .bfw-stars { opacity: 1; }

        .bfw-scene {
          position: absolute;
          inset: -6%;
          animation: bfw-drift 42s ease-in-out infinite alternate;
        }
        @keyframes bfw-drift {
          0%   { transform: translate(0, 0) scale(1.02); }
          100% { transform: translate(var(--drift-x), var(--drift-y)) scale(1.02); }
        }

        .bfw-cloud {
          position: absolute;
          fill: var(--cloud);
          transition: fill 1.2s ease;
        }
        .bfw-cloud-a { animation: bfw-cloud-drift-a 70s linear infinite; }
        .bfw-cloud-b { animation: bfw-cloud-drift-b 95s linear infinite; }
        .bfw-cloud-c { animation: bfw-cloud-drift-c 60s linear infinite; }
        @keyframes bfw-cloud-drift-a {
          0% { transform: translateX(-20vw); }
          100% { transform: translateX(120vw); }
        }
        @keyframes bfw-cloud-drift-b {
          0% { transform: translateX(-30vw); }
          100% { transform: translateX(130vw); }
        }
        @keyframes bfw-cloud-drift-c {
          0% { transform: translateX(-15vw); }
          100% { transform: translateX(115vw); }
        }

        .bfw-bird { animation: bfw-bird-flap 1.1s ease-in-out infinite alternate; transform-origin: center; }
        @keyframes bfw-bird-flap {
          0% { transform: scaleY(1); }
          100% { transform: scaleY(0.55); }
        }
        .bfw-bird-group-a { animation: bfw-bird-fly-a 34s linear infinite; }
        .bfw-bird-group-b { animation: bfw-bird-fly-b 46s linear infinite; }
        @keyframes bfw-bird-fly-a {
          0% { transform: translate(-10vw, 60vh); }
          100% { transform: translate(110vw, 10vh); }
        }
        @keyframes bfw-bird-fly-b {
          0% { transform: translate(-10vw, 20vh); }
          100% { transform: translate(110vw, 55vh); }
        }

        .bfw-sun {
          transition: fill 1.2s ease, opacity 1.2s ease;
        }

        @media (prefers-reduced-motion: reduce) {
          .bfw-scene, .bfw-cloud-a, .bfw-cloud-b, .bfw-cloud-c,
          .bfw-bird, .bfw-bird-group-a, .bfw-bird-group-b {
            animation: none !important;
          }
        }
      `}</style>

      {/* Sky */}
      <div className="bfw-sky" />
      <svg className="bfw-stars absolute inset-0 h-full w-full" aria-hidden>
        {Array.from({ length: 40 }).map((_, i) => (
          <circle
            key={i}
            cx={`${(i * 47) % 100}%`}
            cy={`${(i * 31) % 60}%`}
            r={i % 5 === 0 ? 1.4 : 0.8}
            fill="#F4F7F6"
            opacity={0.3 + ((i * 13) % 60) / 100}
          />
        ))}
      </svg>

      {/* Sun / moon */}
      <svg
        className="pointer-events-none absolute right-[12%] top-[10%] h-40 w-40"
        viewBox="0 0 200 200"
        aria-hidden
      >
        <circle cx="100" cy="100" r="90" fill="var(--sun-glow)" />
        <circle className="bfw-sun" cx="100" cy="100" r="46" fill="var(--sun-core)" />
      </svg>

      {/* Drifting island + sea scene */}
      <div className="bfw-scene">
        <IslandScene />
      </div>

      {/* Clouds */}
      <svg
        className="bfw-cloud bfw-cloud-a pointer-events-none absolute left-0 top-[18%] h-16 w-40"
        viewBox="0 0 200 90"
        aria-hidden
      >
        <CloudShape />
      </svg>
      <svg
        className="bfw-cloud bfw-cloud-b pointer-events-none absolute left-0 top-[8%] h-12 w-32"
        viewBox="0 0 200 90"
        aria-hidden
      >
        <CloudShape />
      </svg>
      <svg
        className="bfw-cloud bfw-cloud-c pointer-events-none absolute left-0 top-[30%] h-10 w-28"
        viewBox="0 0 200 90"
        aria-hidden
      >
        <CloudShape />
      </svg>

      {/* Birds */}
      <svg className="bfw-bird-group-a pointer-events-none absolute h-10 w-24" viewBox="0 0 120 40" aria-hidden>
        <BirdPair />
      </svg>
      <svg className="bfw-bird-group-b pointer-events-none absolute h-8 w-20" viewBox="0 0 120 40" aria-hidden>
        <BirdPair />
      </svg>

      {/* Theme toggle */}
      <button
        type="button"
        onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
        aria-label="Toggle day and night"
        className="absolute right-5 top-5 z-20 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-md transition-colors"
        style={{
          background: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
          color: 'var(--text-strong)',
        }}
      >
        {theme === 'light' ? '☀ Day' : '☾ Night'}
      </button>

      {/* Foreground: logo + form */}
      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-16">
        <div
          className="w-full max-w-sm rounded-2xl border p-8 shadow-2xl backdrop-blur-xl"
          style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
        >
          <div className="flex justify-center">
            <img
              src={theme === 'light' ? '/logo-light.png' : '/logo-dark.png'}
              alt="Biliran Flood Watch"
              className="h-16 w-auto select-none"
              draggable={false}
            />
          </div>

          <p
            className="mt-2 text-center text-sm"
            style={{ color: 'var(--text-soft)' }}
          >
            Sign in to view current flood conditions.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              valid={email.length > 0 && emailValid}
              autoComplete="email"
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              valid={password.length > 0 && passwordValid}
              autoComplete="current-password"
            />

            {error && (
              <p role="alert" className="rounded-md bg-[#FBEEE0]/90 px-3 py-2 text-sm text-[#8A4B12]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !emailValid || !passwordValid}
              className="w-full rounded-md bg-[#E8A33D] py-2.5 text-sm font-semibold text-[#0B3654] transition-colors hover:bg-[#DB962E] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm" style={{ color: 'var(--text-soft)' }}>
            Trouble signing in?{' '}
            <a
              href="/reset"
              className="font-medium underline underline-offset-4"
              style={{ color: 'var(--text-strong)' }}
            >
              Reset your password
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  type,
  value,
  onChange,
  valid,
  autoComplete,
}: {
  label: string
  type: string
  value: string
  onChange: (v: string) => void
  valid: boolean
  autoComplete?: string
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium" style={{ color: 'var(--text-strong)' }}>
        {label}
      </span>
      <div className="relative mt-1.5">
        <input
          type={type}
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          required
          className="w-full border-0 border-b-2 bg-transparent px-0 py-2 outline-none focus:ring-0"
          style={{ borderColor: 'var(--field-line)', color: 'var(--text-strong)' }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 h-[2px] bg-[#E8A33D] transition-all duration-500 ease-out"
          style={{ width: valid ? '100%' : '0%' }}
        />
      </div>
    </label>
  )
}

/** Simplified bird's-eye Biliran island: sea, coastline, elevation contours, central peak. */
function IslandScene() {
  return (
    <svg
      className="h-full w-full"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      {/* sea */}
      <defs>
        <radialGradient id="bfw-sea-grad" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="var(--sea-bottom)" />
          <stop offset="100%" stopColor="var(--sea-top)" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="1000" height="1000" fill="url(#bfw-sea-grad)" />

      {/* faint wave rings */}
      {[420, 470, 520, 570].map((r) => (
        <circle
          key={r}
          cx="500"
          cy="520"
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="2"
        />
      ))}

      {/* island landmass, elongated like Biliran's silhouette */}
      <path
        d="M 500 220
           C 610 230, 700 280, 740 360
           C 790 450, 780 540, 730 610
           C 690 665, 630 720, 560 750
           C 500 775, 430 760, 390 715
           C 340 660, 300 590, 290 510
           C 280 420, 320 330, 400 275
           C 430 255, 465 225, 500 220 Z"
        fill="var(--land)"
      />

      {/* elevation contours toward the center */}
      <path
        d="M 500 280 C 590 290, 660 335, 690 400 C 720 470, 705 540, 665 590
           C 630 635, 575 665, 520 675 C 460 685, 405 665, 375 620
           C 340 570, 335 500, 355 440 C 375 380, 430 320, 500 280 Z"
        fill="none"
        stroke="var(--contour)"
        strokeWidth="4"
        opacity="0.55"
      />
      <path
        d="M 500 350 C 555 358, 600 390, 615 435 C 630 480, 615 525, 580 555
           C 550 580, 510 592, 470 585 C 435 578, 405 555, 392 520
           C 378 483, 385 440, 415 405 C 440 375, 470 355, 500 350 Z"
        fill="none"
        stroke="var(--contour)"
        strokeWidth="4"
        opacity="0.5"
      />

      {/* central peak, stands in for Mt. Suiro / interior ranges */}
      <path
        d="M 470 430 L 500 380 L 535 430 L 555 470 L 445 470 Z"
        fill="var(--mountain)"
        opacity="0.85"
      />
      <path
        d="M 470 430 L 500 380 L 512 400 L 485 440 Z"
        fill="rgba(255,255,255,0.35)"
      />

      {/* a few settlement dots along the coast, evocative of barangays */}
      {[
        [420, 300],
        [640, 380],
        [660, 560],
        [480, 700],
        [360, 560],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="6" fill="var(--land-dark)" opacity="0.8" />
      ))}
    </svg>
  )
}

function CloudShape() {
  return (
    <path
      d="M 30 70 C 10 70, 0 55, 10 42 C 12 25, 32 18, 45 27
         C 52 12, 78 12, 88 27 C 105 22, 122 35, 118 50
         C 130 52, 132 70, 118 70 Z"
      opacity="0.9"
    />
  )
}

function BirdPair() {
  return (
    <g fill="none" stroke="var(--bird)" strokeWidth="4" strokeLinecap="round">
      <path className="bfw-bird" d="M 10 20 Q 20 5, 30 20 Q 40 5, 50 20" />
      <path className="bfw-bird" d="M 60 12 Q 68 0, 76 12 Q 84 0, 92 12" style={{ animationDelay: '0.3s' }} />
    </g>
  )
}
