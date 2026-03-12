export type LocalizedPlace = {
  zh: string;
  en: string;
};

export type DayRange = {
  min: number;
  max: number;
};

export type RouteGroup = {
  id: string;
  name_zh: string;
  name_en: string;
  tagline: string;
  difficulty_shells: number;
  default_variant_id: string;
  official_url: string;
  variants: string[];
};

export type RouteVariant = {
  id: string;
  group_id: string;
  variant_name_zh: string;
  variant_name_en: string;
  start_place: LocalizedPlace;
  end_place: LocalizedPlace;
  distance_km_total: number;
  days_recommended_total: DayRange;
  distance_km_map: number;
  days_recommended_map: DayRange;
  highlights: string[];
  cautions: string[];
  geometry_source: string;
  geometry_path: string;
  note?: string;
  route_impression?: string;
  positioning?: string;
  best_for?: string[];
  not_for?: string[];
  experience?: string[];
  season_advice?: string[];
  certificate_and_starts?: string[];
  stay_supply_pressure?: string[];
  list_hint?: string;
  countriesPassed?: string[];
  mainWalkingCountry?: string;
  usualSchengenApplyCountry?: string;
  visa_planning?: string[];
};

export type AtlasData = {
  routeGroups: RouteGroup[];
  routeVariants: RouteVariant[];
};
