import type { RouteGroup, RouteVariant } from '../types/routes';
import { formatRouteLineZhEn, stripParenEnglish } from '../utils/formatName';
import { getDifficultyLevel, getHotLabel, getRouteDisplayNames, getRouteSummary } from '../utils/routeDisplay';
import type { ReactNode } from 'react';

type Props = {
  group: RouteGroup | null;
  variant: RouteVariant | null;
  isFavorite: boolean;
  compactFavoriteLabel?: boolean;
  onToggleFavorite: (variantId: string) => void;
};

function keepTailTogether(text: string): ReactNode {
  const trimmed = text.trim();
  const match = trimmed.match(/^(.*?)([\u4e00-\u9fff]{2,4}[。！？，、；：]?|[\u4e00-\u9fff][的了呢吗呀啊哦吧]+)$/u);
  if (!match) return trimmed;
  const [, head, tail] = match;
  if (!head || !tail || tail.length < 2) return trimmed;
  return (
    <>
      {head}
      <span className="keep-together">{tail}</span>
    </>
  );
}

function renderList(items?: string[], keepTail = false) {
  if (!items?.length) return <p className="empty-field">待补充</p>;
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{keepTail ? keepTailTogether(item) : item}</li>
      ))}
    </ul>
  );
}

function splitImpressionLines(text?: string) {
  if (!text?.trim()) return ['路线简介待补充'];
  const parts = text
    .split('。')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => `${part}。`);
  return parts.length ? parts : [text.trim()];
}

export function RouteDetail({ group, variant, isFavorite, onToggleFavorite }: Props) {
  if (!variant || !group) {
    return <div className="route-detail-empty">请选择左侧路线查看详情。</div>;
  }

  const days = variant.days_recommended_total;
  const routeLine = formatRouteLineZhEn(
    variant.start_place?.zh,
    variant.start_place?.en,
    variant.end_place?.zh,
    variant.end_place?.en,
  );
  const difficulty = getDifficultyLevel(group);
  const hot = getHotLabel(group.id, variant.id);
  const displayNames = getRouteDisplayNames(group, variant);
  const isAfterSantiagoMain =
    group.id === 'camino-finisterre-after-santiago' && variant.id === 'camino-finisterre-main';
  const groupZh = displayNames.groupZh || stripParenEnglish(group.name_zh || '') || group.name_zh;
  const groupEnDisplay = displayNames.groupEn;
  const variantEnDisplay = displayNames.variantEn;
  const routeImpression = getRouteSummary(group, variant);
  const routeNoteLines = (variant as RouteVariant & { route_note_lines?: string[] }).route_note_lines;
  const rawImpressionLines = routeNoteLines?.length
    ? routeNoteLines.slice(0, 2)
    : splitImpressionLines(routeImpression);
  const impressionLines = rawImpressionLines.map((line) =>
    isAfterSantiagoMain
      ? line.replace(
          '重点是海岸风雨、节奏放缓与主线后恢复管理，不宜当成纯休闲散步。',
          '重点在于适应海岸风雨、重新调整节奏，并兼顾主线结束后的体能恢复，不适合当成纯放松散步。',
        )
      : line,
  );
  const experience = variant.experience?.length ? variant.experience : [variant.positioning || group.tagline];
  const visaInfo = variant.visa_planning?.length
    ? variant.visa_planning
    : [
        `经过国家：${variant.countriesPassed?.join(' / ') || '待补充'}`,
        `常见申根申请国：${variant.usualSchengenApplyCountry || '待补充'}`,
        `主要行走国家：${variant.mainWalkingCountry || '待补充'}`,
      ];

  return (
    <article className="route-detail">
      <header className="detail-header detail-top">
        <div className="detail-main">
          <h2 className="detail-title">{groupZh}</h2>
          <p className="detail-subtitle">{groupEnDisplay} / {variantEnDisplay}</p>
          <p className="detail-route-line">{routeLine}</p>
          <div className="route-hook">
            <span className="route-hook-line" aria-hidden="true" />
            <div className="route-hook-body">
              <div className="route-hook-kicker">
                <span className="route-hook-kicker-text">路线印象</span>
              </div>
              <div className="route-hook-text">
                {impressionLines.map((line) => (
                  <span key={line} className="route-hook-line-text">
                    {line}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        <aside className="detail-side">
          <div className="detail-rates">
            <div className="detail-rate-block">
              <span>整体难度</span>
              <div className="difficulty-bars" aria-label={`difficulty-${difficulty}`}>
                {Array.from({ length: 5 }).map((_, index) => (
                  <i key={index} className={index < difficulty ? 'active' : ''} />
                ))}
              </div>
            </div>
            <div className="detail-rate-block">
              <span>热门程度</span>
              <strong>{hot}</strong>
            </div>
          </div>
          <button
            type="button"
            className="favorite-btn detail-favorite-btn"
            onClick={() => onToggleFavorite(variant.id)}
          >
            {isFavorite ? '已加入贝壳袋' : '加入贝壳袋'}
          </button>
        </aside>
      </header>

      <div className="detail-stats">
        <div>
          <span>全程距离</span>
          <strong>{variant.distance_km_total} km</strong>
        </div>
        <div>
          <span>推荐天数</span>
          <strong>{days.min === days.max ? `${days.min} 天` : `${days.min}-${days.max} 天`}</strong>
        </div>
      </div>

      <section className="detail-grid">
        <div className="detail-block">
          <h3>更适合谁</h3>
          {renderList(variant.best_for, true)}
        </div>
        <div className="detail-block">
          <h3>不太适合谁</h3>
          {renderList(variant.not_for, true)}
        </div>
        <div className="detail-block">
          <h3>路线定位 / 徒步体验</h3>
          {renderList(experience, true)}
        </div>
        <div className="detail-block">
          <h3>季节建议</h3>
          {renderList(variant.season_advice, true)}
        </div>
        <div className="detail-block">
          <h3>证书说明 / 常见走法</h3>
          {renderList(variant.certificate_and_starts)}
        </div>
        <div className="detail-block">
          <h3>住宿与补给压力</h3>
          {renderList(variant.stay_supply_pressure)}
        </div>
        <div className="detail-block">
          <h3>国家 / 签证信息</h3>
          {renderList(visaInfo)}
        </div>
        <div className="detail-block">
          <h3>注意事项</h3>
          {renderList(variant.cautions, true)}
        </div>
      </section>
    </article>
  );
}
