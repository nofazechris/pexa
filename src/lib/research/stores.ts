import 'server-only';
import { geocode } from '@/lib/geo/service';
import { recordStores } from '@/lib/shopping/service';
import { highlightsOf, parsePlaces, rankStores, storeOptions } from '@/lib/shopping/stores';
import type { StepState } from './engine';
import type { ResearchResult } from './types';

/**
 * A nearby-store search, second half: Google Maps was searched (and paid for through Buy); now read the stores, measure how far each is
 * from the person's place, rank them, and keep the best with the shopping-list item. Whatever happens the card says what was spent.
 */
export async function fillStores(userId: string, result: ResearchResult, states: readonly StepState[]): Promise<void> {
  const paid = states.find((s) => s.role === 'places' && s.outcome === 'PAID');
  if (!paid) return; // nothing was searched: the summary already says so
  const { what, place } = result.request;

  const hits = parsePlaces(paid.output);
  const origin = place ? await geocode(place).catch(() => null) : null;
  const measuring = origin && origin.precise ? { lat: origin.lat, lon: origin.lon } : null;
  const stores = rankStores(hits, measuring);
  const highlights = highlightsOf(stores);
  result.stores = { query: what, place, stores, highlights, measured: Boolean(measuring) && stores.some((s) => s.distanceKm !== null) };

  if (!stores.length) {
    result.summary = hits.length ? `Google Maps only listed places that have closed for good for “${what}”${place ? ` near ${place}` : ''}.` : `Google Maps didn’t list any stores for “${what}”${place ? ` near ${place}` : ''}. Try a more general name, or a nearby area.`;
    result.notes.push(`The search cost ${result.spent}. Nothing was bought.`);
    return;
  }
  result.summary = `Found ${stores.length} store${stores.length === 1 ? '' : 's'} for “${what}”${place ? ` near ${place}` : ''}${result.stores.measured ? ', nearest first' : ''}.`;
  if (result.request.itemId) await recordStores(userId, result.request.itemId, storeOptions(stores, new Date())).catch((e) => console.error('[stores] save failed:', e instanceof Error ? e.message : e));
  result.notes.push(result.stores.measured ? `Distances are straight-line from ${place}, not road distance.` : 'I couldn’t pin down exactly where you are, so the stores are in the order Google listed them.');
  result.notes.push('Google lists a store whether or not it has this exact item. Call before you travel to check it is in stock and at what price. Pexa does not pay stores — you do, in person or on the phone.');
}
