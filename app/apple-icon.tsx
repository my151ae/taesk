import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const size = {
  width: 180,
  height: 180,
}

export const contentType = 'image/png'

const isProduction =
  process.env.VERCEL_ENV === 'production' ||
  (!process.env.VERCEL_ENV && process.env.NODE_ENV === 'production')

export default function AppleIcon() {
  const showDevBadge = !isProduction

  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 256,
          background: showDevBadge ? '#f59e0b' : '#0ea5e9',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontWeight: 'bold',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{
            width: '40px',
            height: '100px',
            background: 'white',
            borderRadius: '4px',
            opacity: 0.9,
          }} />
          <div style={{
            width: '40px',
            height: '100px',
            background: 'white',
            borderRadius: '4px',
            opacity: 0.9,
          }} />
          <div style={{
            width: '40px',
            height: '100px',
            background: 'white',
            borderRadius: '4px',
            opacity: 0.9,
          }} />
        </div>
        {showDevBadge ? (
          <div
            style={{
              position: 'absolute',
              right: '10px',
              bottom: '10px',
              background: '#111827',
              color: 'white',
              fontSize: '36px',
              fontWeight: 900,
              letterSpacing: '2px',
              padding: '6px 10px',
              borderRadius: '8px',
              lineHeight: 1,
            }}
          >
            DEV
          </div>
        ) : null}
      </div>
    ),
    {
      ...size,
    }
  )
}
