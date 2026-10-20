/** Test-only helpers. Not reachable from any public package entry. */
export {
  bytesResponse,
  createFakeFetch,
  dataUrl,
  GIF_BYTES,
  hangingResponse,
  JPEG_BYTES,
  jsonResponse,
  PNG_BYTES,
  textResponse,
  type FakeFetch,
  type FakeRoute,
  type RecordedRequest,
  type Responder,
} from "./fake-fetch.ts";
export { assertRateTable, type ExpectedRates } from "./rates.ts";
