import type { OptionSnap } from './options';

/** A shopping-list item as the chat card shows it. */
export interface ShoppingItemView {
  id: string;
  title: string;
  targetText: string | null;
  place: string;
  platforms: string[];
  status: 'active' | 'bought' | 'dropped';
  /** The latest ranked options, best first (rated sellers, then any web pages they added). */
  options: OptionSnap[];
  /** What changed at the last refresh, in plain words. */
  changes: string[];
  researchedAt: string | null;
  createdAt: string;
}
