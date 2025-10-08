import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const size = {
  width: 512,
  height: 512,
}

export const contentType = 'image/png'

export default function Icon() {
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
          borderRadius: '64px',
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
      </div>
    ),
    {
      ...size,
    }
  )
}
