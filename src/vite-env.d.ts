/// <reference types="vite/client" />

declare module 'tz-lookup' {
  /** IANA time-zone name for a latitude/longitude. */
  const tzlookup: (lat: number, lon: number) => string;
  export default tzlookup;
}
