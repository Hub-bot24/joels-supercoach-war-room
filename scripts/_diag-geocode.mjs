import { geocodeVenue } from "./update-status.mjs";

const result = await geocodeVenue("Mudgee");
console.log("[diag] geocodeVenue('Mudgee'):", JSON.stringify(result));
