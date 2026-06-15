export default function Placeholder({ name, note }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: 320, color: '#64748B', textAlign: 'center',
    }}>
      <div style={{ fontSize: 38, marginBottom: 12 }}>🚧</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>{name}</div>
      <div style={{ fontSize: 13, maxWidth: 360 }}>{note || 'Coming in a later phase.'}</div>
    </div>
  );
}
