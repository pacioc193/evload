export function Toggle({ label, checked, onChange, disabled }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div className="relative">
        <input type="checkbox" className="sr-only" checked={checked} onChange={e => onChange(e.target.checked)} disabled={disabled} />
        <div className={`w-11 h-6 rounded-full transition-colors ${checked ? 'bg-green-500' : 'bg-gray-600'} ${disabled ? 'opacity-50' : ''}`} />
        <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </div>
      {label && <span className="text-sm text-gray-200">{label}</span>}
    </label>
  )
}
