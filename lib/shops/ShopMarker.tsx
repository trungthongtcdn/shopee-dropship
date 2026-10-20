// Invisible tag carrying the slug of the shop a dashboard page was rendered for;
// shopFetch reads it. Rendered once by the dashboard layout.
export function ShopMarker({ slug }: { slug: string }) {
  return <span hidden data-shop-slug={slug} />;
}
