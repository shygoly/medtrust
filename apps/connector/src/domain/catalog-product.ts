export interface CatalogProduct {
  id: string;
  providerId: string;
  title?: string;
  fhirSchema?: Record<string, unknown> | null;
}

/** Resolve catalog product metadata (connector outbound to control plane). */
export type CatalogProductResolver = (productId: string) => CatalogProduct | null | undefined;
