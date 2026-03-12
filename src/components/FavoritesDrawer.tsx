import { useMemo } from 'react';
import type { RouteGroup, RouteVariant } from '../types/routes';
import { resolveFavoritesForDrawer } from '../utils/favorites';

type Props = {
  open: boolean;
  favoriteIds: string[];
  variantsById: Record<string, RouteVariant>;
  groupsById: Record<string, RouteGroup>;
  onClose: () => void;
  onSelectVariant: (variantId: string) => void;
  onRemoveFavorite: (variantId: string) => void;
  onClearAll: () => void;
};

export function FavoritesDrawer({
  open,
  favoriteIds,
  variantsById,
  groupsById,
  onClose,
  onSelectVariant,
  onRemoveFavorite,
  onClearAll,
}: Props) {
  const favorites = useMemo(
    () => resolveFavoritesForDrawer(favoriteIds, variantsById, groupsById),
    [favoriteIds, variantsById, groupsById],
  );

  return (
    <div className={`drawer-root ${open ? 'open' : ''}`} aria-hidden={!open}>
      <button className="drawer-backdrop" type="button" onClick={onClose} aria-label="close drawer" />
      <aside className="drawer-panel">
        <header className="drawer-header">
          <div>
            <h3>贝壳袋</h3>
            <p>出发前的路线备选清单</p>
          </div>
          <div className="drawer-actions">
            <button type="button" onClick={onClearAll} disabled={!favorites.length}>
              清空清单
            </button>
            <button type="button" onClick={onClose}>
              关闭
            </button>
          </div>
        </header>
        <div className="drawer-content">
          {favorites.length ? (
            favorites.map((item) => (
              <div key={item.variantId} className="drawer-item">
                <div className="drawer-item-head">
                  <strong>{item.groupZh || '未命名主路线'}</strong>
                  <span>{item.variantZh}</span>
                </div>
                <p className="drawer-item-sub">{item.groupEn} / {item.variantEn}</p>
                <div className="drawer-item-meta">
                  <span>{item.distanceKm} km</span>
                  <span>{item.daysLabel}</span>
                  <span>{item.difficultyLabel}</span>
                  <span>{item.hotLabel}</span>
                </div>
                <p className="drawer-item-note">{item.summary}</p>
                <div className="drawer-item-actions">
                  <button type="button" onClick={() => onSelectVariant(item.variantId)}>
                    查看路线
                  </button>
                  <button type="button" onClick={() => onRemoveFavorite(item.variantId)}>
                    移除
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="drawer-empty">暂时还没有收藏的线路。</p>
          )}
        </div>
      </aside>
    </div>
  );
}
