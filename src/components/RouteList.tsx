import type { RouteGroup, RouteVariant } from '../types/routes';
import { getPopularityLevel } from '../utils/popularity';
import {
  formatPlaceZhEn,
  formatVariantTitleZh,
  shouldShowEnLine,
  stripParenEnglish,
} from '../utils/formatName';

type Props = {
  groups: RouteGroup[];
  variantsById: Record<string, RouteVariant>;
  selectedGroupId: string;
  selectedVariantId: string;
  favoriteIds: string[];
  isSwitching?: boolean;
  switchingVariantId?: string | null;
  onSelectGroup: (groupId: string) => void;
  onSelectVariant: (variantId: string) => void;
};

const SIDEBAR_GROUP_DISPLAY: Record<string, { zh?: string; en?: string }> = {
  'camino-finisterre-after-santiago': {
    zh: '朝圣之后：抵达世界尽头',
    en: 'After Santiago: Reaching the End of the World',
  },
};

const SIDEBAR_VARIANT_DISPLAY: Record<string, { zh?: string; en?: string }> = {
  'camino-del-norte-main': { en: 'Main Route (Irún)' },
  'camino-primitivo-main': { en: 'Main Route (Oviedo)' },
  'via-de-la-plata-main': { en: 'Main Route (Sevilla)' },
  'camino-ingles-main': { en: 'Main Route (Ferrol)' },
  'camino-finisterre-main': {
    zh: '主线（菲尼斯特雷）',
    en: 'Main Route (Fisterra)',
  },
};

function getDaysLabel(min: number, max: number): string {
  if (!min && !max) return '天数待补充';
  if (min === max) return `${min} 天`;
  return `${min}-${max} 天`;
}

export function RouteList({
  groups,
  variantsById,
  selectedGroupId,
  selectedVariantId,
  favoriteIds,
  isSwitching = false,
  switchingVariantId = null,
  onSelectGroup,
  onSelectVariant,
}: Props) {
  function toPlaceText(variant: RouteVariant): string {
    const start = formatPlaceZhEn(variant.start_place?.zh, variant.start_place?.en);
    const end = formatPlaceZhEn(variant.end_place?.zh, variant.end_place?.en);
    return `${start} -> ${end}`;
  }

  return (
    <div className="route-list-wrap">
      {groups.map((group) => {
        const isActiveGroup = group.id === selectedGroupId;
        const groupDisplay = SIDEBAR_GROUP_DISPLAY[group.id];
        const groupZhRaw = groupDisplay?.zh ?? group.name_zh ?? '';
        const groupEn = (groupDisplay?.en ?? group.name_en ?? '').trim();
        const groupZh = stripParenEnglish(groupZhRaw);
        const showGroupEn = shouldShowEnLine(groupZhRaw, groupEn);
        return (
          <section key={group.id} className={`route-group ${isActiveGroup ? 'active' : ''}`}>
            <button
              type="button"
              className={`route-group-button ${isSwitching ? 'is-locked' : ''}`}
              onClick={() => {
                if (isSwitching) return;
                onSelectGroup(group.id);
              }}
              aria-pressed={isActiveGroup}
              aria-disabled={isSwitching}
            >
              <div>
                <h3 className="group-zh">{groupZh || '未命名路线'}</h3>
                {showGroupEn ? <p className="group-en">{groupEn}</p> : null}
                <div className="group-tagline">{group.tagline || '路线说明待补充'}</div>
              </div>
            </button>

            <div className="variant-list">
              {group.variants.map((variantId) => {
                const variant = variantsById[variantId];
                if (!variant) return null;
                const isActive = variant.id === selectedVariantId;
                const isSwitchingTarget = switchingVariantId === variant.id;
                const favored = favoriteIds.includes(variant.id);
                const variantDisplay = SIDEBAR_VARIANT_DISPLAY[variant.id];
                const variantZhRaw = variantDisplay?.zh ?? variant.variant_name_zh;
                const variantZh = formatVariantTitleZh(variantZhRaw, variant.start_place?.zh);
                const variantEn = (variantDisplay?.en ?? variant.variant_name_en ?? '').trim();
                const showVariantEn = shouldShowEnLine(variantZhRaw || '', variantEn);
                const hot = '🔥'.repeat(getPopularityLevel(group.id, variant.id));
                return (
                  <button
                    key={variant.id}
                    type="button"
                    className={`variant-card ${isActive ? 'active' : ''} ${isSwitching ? 'is-locked' : ''} ${isSwitchingTarget ? 'is-switching-target' : ''}`}
                    onClick={() => {
                      if (isSwitching) return;
                      onSelectVariant(variant.id);
                    }}
                    aria-pressed={isActive}
                    aria-disabled={isSwitching}
                  >
                    <div className="variant-head">
                      <strong>{variantZh || '未命名子线路'}</strong>
                      {favored ? <span className="fav-dot">已收藏</span> : null}
                    </div>
                    {showVariantEn ? <span className="variant-en">{variantEn}</span> : null}
                    <div className="variant-meta">
                      <span className="variant-meta-left">{variant.distance_km_total} km</span>
                      <span className="variant-meta-right">
                        {getDaysLabel(variant.days_recommended_total.min, variant.days_recommended_total.max)}
                        <span className="hot-level variant-hot">{hot}</span>
                      </span>
                    </div>
                    <div className="variant-route">{toPlaceText(variant)}</div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
