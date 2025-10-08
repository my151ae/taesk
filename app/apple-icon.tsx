import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const size = {
  width: 180,
  height: 180,
}

export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 256,
          background: '#0ea5e9',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontWeight: 'bold',
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
      </div>
    ),
    {
      ...size,
    }
  )
}
