// Malawi Kwacha is decimal (1 K = 100 tambala). All money is rounded to 2dp
// on write (server) and formatted consistently as K0.00 for display.
export function formatMWK(amount) {
  const n = Number(amount) || 0;
  return `K${n.toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
