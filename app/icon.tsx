import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const size = {
  width: 512,
  height: 512,
}

export const contentType = 'image/png'

const isProduction =
  process.env.VERCEL_ENV === 'production' ||
  (!process.env.VERCEL_ENV && process.env.NODE_ENV === 'production')

export default function Icon() {
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
          borderRadius: '64px',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', gap: '20px' }}>
          <div style={{
            width: '120px',
            height: '280px',
            background: 'white',
            borderRadius: '12px',
            opacity: 0.9,
          }} />
          <div style={{
            width: '120px',
            height: '280px',
            background: 'white',
            borderRadius: '12px',
            opacity: 0.9,
          }} />
          <div style={{
            width: '120px',
            height: '280px',
            background: 'white',
            borderRadius: '12px',
            opacity: 0.9,
          }} />
        </div>
        {showDevBadge ? (
          <div
            style={{
              position: 'absolute',
              right: '28px',
              bottom: '28px',
              background: '#111827',
              color: 'white',
              fontSize: '74px',
              fontWeight: 900,
              letterSpacing: '6px',
              padding: '12px 20px',
              borderRadius: '18px',
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
