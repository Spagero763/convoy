/**
 * Shown when the app is running without a venue address. Better a plain
 * explanation than a board that silently reads zero everywhere.
 */
export function NotConfigured() {
  return (
    <div className="notice notice-warn">
      <p className="notice-title">No venue address configured.</p>
      <p className="notice-body">
        Set <code>NEXT_PUBLIC_VENUE_ADDRESS</code> to the deployed ConvoyVenue
        contract and restart. Until then the board has nothing to read.
      </p>
    </div>
  );
}
