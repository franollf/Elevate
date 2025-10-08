// app/api/directions/route.js
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const origin      = searchParams.get("origin");
  const destination = searchParams.get("destination");
  const apiKey      = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const url = `https://maps.googleapis.com/maps/api/directions/json`
    + `?origin=${encodeURIComponent(origin)}`
    + `&destination=${encodeURIComponent(destination)}`
    + `&key=${apiKey}`;

  const res  = await fetch(url);
  const data = await res.json();

  // now data.routes will be the array you map over
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}
