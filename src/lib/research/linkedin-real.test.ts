import { describe, expect, it } from 'vitest';
import { liPeople } from './read';
import { scoreLinkedIn } from './score';

const NOW = new Date('2026-10-17T12:00:00Z');

/** The shape LinkedIn's people search really returned on 2026-10-17 (values invented): three people and a pagination block. */
const real = [
  {
    id: 'ACoAAA1',
    name: 'Ada Example',
    position: 'Graphic Designer at Gradenet',
    location: { linkedinText: 'Lagos, Lagos State, Nigeria', countryCode: 'NG', parsed: { text: 'Lagos, Lagos State, Nigeria', countryCode: 'NG', country: 'Nigeria', state: 'Lagos State', city: 'Lagos' } },
    linkedinUrl: 'https://www.linkedin.com/in/ada-example-123',
    linkedinProfileUrl: 'https://www.linkedin.com/in/ACoAAA1',
    publicIdentifier: 'ada-example-123',
    firstName: 'Ada',
    lastName: 'Example',
    headline: 'Graphic Designer at Gradenet',
    openToWork: true,
    hiring: false,
    premium: false,
    registeredAt: '2022-03-30T10:00:00.000Z',
    connectionsCount: 698,
    followerCount: 696,
    verified: false,
    about: 'I design logos, brand identity and social media graphics for small businesses.',
    services: { servicesList: ['Logo design', 'Brand identity', 'Social media graphics'], requestUrl: 'https://example.com' },
    experience: [{ position: 'Graphic Designer', companyName: 'Gradenet', companyLinkedinUrl: 'https://www.linkedin.com/company/gradenet' }],
    skills: [{ name: 'Adobe Illustrator', positions: [] }, { name: 'Branding', positions: [] }],
    sectionTotals: { experience: 1, education: 1, receivedRecommendations: 2, skills: 2 },
  },
  { name: 'Bayo Test', headline: 'Student', location: { linkedinText: 'Oslo, Norway' }, linkedinUrl: 'https://www.linkedin.com/in/bayo-test', connectionsCount: 12, registeredAt: '2026-09-20T00:00:00.000Z', experience: [], sectionTotals: { receivedRecommendations: 0 } },
  { name: 'Chi Sample', headline: 'Product Designer', location: { linkedinText: 'Lagos, Nigeria' }, linkedinUrl: 'https://www.linkedin.com/in/chi-sample', connectionsCount: 6606, verified: true, registeredAt: '2024-06-12T00:00:00.000Z', experience: [{}, {}, {}], services: { servicesList: ['UI design'] } },
  { _meta: { pagination: { totalElements: 3, totalPages: 1, pageNumber: 1, pageSize: 5 } } },
];

describe('the real LinkedIn people-search response', () => {
  const people = liPeople(real);
  it('reads the three people and ignores the pagination block', () => {
    expect(people.map((p) => p.name)).toEqual(['Ada Example', 'Bayo Test', 'Chi Sample']);
  });
  it('reads location text, counts, join date, services, skills and recommendations', () => {
    expect(people[0]).toMatchObject({ location: 'Lagos, Lagos State, Nigeria', connections: 698, followers: 696, experienceCount: 1, openToWork: true, recommendations: 2, url: 'https://www.linkedin.com/in/ada-example-123' });
    expect(people[0].services).toEqual(['Logo design', 'Brand identity', 'Social media graphics']);
    expect(people[0].skills).toEqual(['Adobe Illustrator', 'Branding']);
    expect(people[0].joined?.getUTCFullYear()).toBe(2022);
    expect(people[2].verified).toBe(true);
  });
  it('a relevant, established, local, available person is a strong match with plain reasons', () => {
    const item = scoreLinkedIn(people[0], { what: 'graphic designer', place: 'Yaba, Lagos' }, NOW);
    expect(item.verdict).toBe('solid');
    const text = item.signals.map((s) => s.text).join(' | ');
    expect(text).toMatch(/Open to work/);
    expect(text).toMatch(/2 recommendations/);
    expect(text).toMatch(/Offers: Logo design/);
    expect(item.nearness).toBe('city');
  });
  it('a brand-new, far-away, thin profile is not recommended', () => {
    const item = scoreLinkedIn(people[1], { what: 'graphic designer', place: 'Yaba, Lagos' }, NOW);
    expect(item.verdict).toBe('careful');
    expect(item.signals.some((s) => /Brand-new profile/.test(s.text))).toBe(true);
  });
});
