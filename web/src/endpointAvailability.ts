export interface EndpointAdvertisement {
  methods: string[];
  capabilities: string[];
}

export type EndpointAvailability = Record<string, EndpointAdvertisement | null>;

export function parseEndpointAdvertisement(
  value: unknown,
): EndpointAdvertisement | null {
  if (!value || typeof value !== "object") return null;
  const advertisement = value as EndpointAdvertisement;
  if (
    ![advertisement.methods, advertisement.capabilities].every(
      (values) =>
        Array.isArray(values) &&
        values.every((value) => typeof value === "string"),
    )
  )
    return null;
  return {
    methods: [...advertisement.methods],
    capabilities: [...advertisement.capabilities],
  };
}

export function parseEndpointAvailability(
  value: unknown,
): EndpointAvailability {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([id, advertisement]) => [
      id,
      parseEndpointAdvertisement(advertisement),
    ]),
  );
}

export function endpointMethodReason(
  mode: "browser-local" | "shared",
  advertisement: EndpointAdvertisement | null | undefined,
  method: string,
): string | null {
  if (mode === "shared") return null;
  if (!advertisement)
    return "Endpoint availability is loading. Open the source terminal and wait for it to connect.";
  return advertisement.methods.includes(method)
    ? null
    : `Herdr endpoint does not advertise ${method}`;
}
