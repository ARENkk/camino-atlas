import { useEffect, useMemo, useRef, useState } from 'react';
import routesData from '../data/routes.json';
import { FavoritesDrawer } from './components/FavoritesDrawer';
import { MapView } from './components/MapView';
import { CaminoHistoryModal } from './components/CaminoHistoryModal';
import { RouteDetail } from './components/RouteDetail';
import { RouteList } from './components/RouteList';
import type { AtlasData, RouteVariant } from './types/routes';
import { HEAVY_ROUTE_GEOMETRY_PATHS, prefetchRouteGeometries } from './data/routeGeometry';
import { FAVORITES_STORAGE_KEY, normalizeFavoriteVariantIds, readFavoriteIdsFromStorage } from './utils/favorites';

const atlasData = routesData as AtlasData;
const FORMSPREE_ENDPOINT = 'https://formspree.io/f/mjgawgza';
const ENABLE_ROUTE_DEBUG = false;

function routeDebug(...args: unknown[]) {
  if (!ENABLE_ROUTE_DEBUG) return;
  console.log('[RouteDebug][App]', ...args);
}

function getGroupDefaultVariantId(
  groupId: string,
  variants: RouteVariant[],
  fallbackId?: string,
): string | null {
  const byGroup = variants.filter((item) => item.group_id === groupId);
  if (!byGroup.length) return null;
  if (fallbackId && byGroup.some((item) => item.id === fallbackId)) return fallbackId;
  return byGroup[0].id;
}

export default function App() {
  const groups = atlasData.routeGroups;
  const variants = atlasData.routeVariants;

  const variantsById = useMemo(() => {
    return variants.reduce<Record<string, RouteVariant>>((acc, item) => {
      acc[item.id] = item;
      return acc;
    }, {});
  }, [variants]);

  const groupsById = useMemo(() => {
    return groups.reduce<Record<string, AtlasData['routeGroups'][number]>>((acc, item) => {
      acc[item.id] = item;
      return acc;
    }, {});
  }, [groups]);

  const initialGroupId = groups[0]?.id ?? '';
  const initialVariantId =
    getGroupDefaultVariantId(initialGroupId, variants, groups[0]?.default_variant_id) ?? '';
  const validVariantIds = useMemo(() => new Set(variants.map((item) => item.id)), [variants]);

  const [activeGroupId, setActiveGroupId] = useState(initialGroupId);
  const [selectedVariantId, setSelectedVariantId] = useState(initialVariantId);
  const [renderedVariantId, setRenderedVariantId] = useState('');
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readFavoriteIdsFromStorage(validVariantIds));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mobileRouteListOpen, setMobileRouteListOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [introReady, setIntroReady] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const bodyOverflowRef = useRef<string | null>(null);
  const [feedbackForm, setFeedbackForm] = useState({
    feedbackType: '信息有误',
    detail: '',
    contact: '',
  });

  const selectedVariant = variantsById[selectedVariantId] ?? null;
  const selectedGroup = selectedVariant ? groupsById[selectedVariant.group_id] : null;
  const isRouteSwitching = Boolean(selectedVariant && renderedVariantId !== selectedVariant.id);

  function handleSelectGroup(groupId: string) {
    setActiveGroupId(groupId);
    const group = groupsById[groupId];
    const nextVariantId = getGroupDefaultVariantId(groupId, variants, group?.default_variant_id);
    if (nextVariantId) {
      routeDebug('switch requested', {
        nextVariantId,
        source: 'group',
        selectedVariantId,
        renderedVariantId,
      });
      setSelectedVariantId(nextVariantId);
    }
  }

  function handleSelectVariant(variantId: string) {
    const variant = variantsById[variantId];
    if (!variant) return;
    routeDebug('switch requested', {
      nextVariantId: variantId,
      source: 'variant',
      selectedVariantId,
      renderedVariantId,
    });
    setSelectedVariantId(variantId);
    setActiveGroupId(variant.group_id);
  }

  function toggleFavorite(variantId: string) {
    setFavoriteIds((prev) =>
      prev.includes(variantId) ? prev.filter((id) => id !== variantId) : [...prev, variantId],
    );
  }

  useEffect(() => {
    setFavoriteIds((prev) => prev.filter((id) => validVariantIds.has(id)));
  }, [validVariantIds]);

  useEffect(() => {
    if (!renderedVariantId || validVariantIds.has(renderedVariantId)) return;
    setRenderedVariantId('');
  }, [renderedVariantId, validVariantIds]);

  useEffect(() => {
    routeDebug('selection state', { selectedVariantId, renderedVariantId });
  }, [renderedVariantId, selectedVariantId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const siblingPaths = (groupsById[activeGroupId]?.variants ?? [])
      .map((variantId) => variantsById[variantId]?.geometry_path)
      .filter((geometryPath): geometryPath is string => Boolean(geometryPath));
    if (!siblingPaths.length) return;

    const pathsToPrefetch = siblingPaths.filter((geometryPath) => geometryPath !== selectedVariant?.geometry_path);
    if (!pathsToPrefetch.length) return;

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const prefetch = () => {
      routeDebug('prefetch siblings', { activeGroupId, pathsToPrefetch });
      prefetchRouteGeometries(pathsToPrefetch);
    };

    if (typeof idleWindow.requestIdleCallback === 'function') {
      const handle = idleWindow.requestIdleCallback(() => prefetch(), { timeout: 1400 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }

    const timer = window.setTimeout(prefetch, 900);
    return () => window.clearTimeout(timer);
  }, [activeGroupId, groupsById, selectedVariant?.geometry_path, variantsById]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!HEAVY_ROUTE_GEOMETRY_PATHS.length) return;

    const nav = navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    };
    if (nav.connection?.saveData) return;
    if (nav.connection?.effectiveType === 'slow-2g' || nav.connection?.effectiveType === '2g') return;

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const prefetchHeavy = () => {
      routeDebug('prefetch heavy routes', { paths: HEAVY_ROUTE_GEOMETRY_PATHS });
      prefetchRouteGeometries(HEAVY_ROUTE_GEOMETRY_PATHS);
    };

    if (typeof idleWindow.requestIdleCallback === 'function') {
      const handle = idleWindow.requestIdleCallback(() => prefetchHeavy(), { timeout: 2800 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }

    const timer = window.setTimeout(prefetchHeavy, 1800);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const normalized = normalizeFavoriteVariantIds(favoriteIds, validVariantIds);
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(normalized));
  }, [favoriteIds, validVariantIds]);

  function openFeedbackModal() {
    setDetailError('');
    setSubmitError('');
    setFeedbackOpen(true);
  }

  function blurActiveElementWithin(selector: string) {
    if (typeof document === 'undefined') return;
    const active = document.activeElement as HTMLElement | null;
    if (!active) return;
    if (active.closest(selector)) active.blur();
  }

  function closeFeedbackModal() {
    if (isSubmitting) return;
    blurActiveElementWithin('.feedback-modal-root');
    setFeedbackOpen(false);
    setDetailError('');
    setSubmitError('');
  }

  function closeDrawer() {
    blurActiveElementWithin('.drawer-root');
    setDrawerOpen(false);
  }

  function closeHistoryModal() {
    blurActiveElementWithin('.history-modal-root');
    setHistoryOpen(false);
  }

  function resetFeedbackForm() {
    setFeedbackForm({
      feedbackType: '信息有误',
      detail: '',
      contact: '',
    });
  }

  async function handleFeedbackSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    if (!feedbackForm.detail.trim()) {
      setDetailError('请填写具体内容');
      setSubmitError('');
      return;
    }

    setDetailError('');
    setSubmitError('');
    setIsSubmitting(true);
    const currentRouteId = selectedVariant?.id || selectedVariantId || '';
    const currentRouteSlug = currentRouteId || '';
    const routeTitle = selectedGroup?.name_zh || selectedVariant?.variant_name_zh || '';
    const routeSubtitle = selectedVariant
      ? `${selectedGroup?.name_en || ''} / ${selectedVariant.variant_name_en || ''}`.trim()
      : '';

    const payload = {
      feedback_type: feedbackForm.feedbackType,
      route_id: currentRouteId,
      route_slug: currentRouteSlug,
      route_title: routeTitle,
      route_subtitle: routeSubtitle,
      message: feedbackForm.detail.trim(),
      contact: feedbackForm.contact.trim(),
      page_url: window.location.href,
      submitted_at: new Date().toISOString(),
      source: 'camino-atlas-feedback-modal',
    };

    try {
      const response = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        setDetailError('');
        setSubmitError('');
        resetFeedbackForm();
        blurActiveElementWithin('.feedback-modal-root');
        setFeedbackOpen(false);
        setToastOpen(true);
        return;
      }

      let errorMessage = '提交失败，请稍后再试';
      try {
        const data = (await response.json()) as {
          errors?: Array<{ message?: string; field?: string }>;
        };
        if (Array.isArray(data?.errors) && data.errors.length) {
          const messages = data.errors
            .map((item) => {
              const raw = `${item?.message || item?.field || ''}`.toLowerCase();
              if (!raw) return '';
              if (raw.includes('required') || raw.includes('missing')) return '有必填项未填写';
              if (raw.includes('invalid') || raw.includes('format')) return '提交内容格式无效';
              return item?.message || item?.field || '';
            })
            .filter(Boolean);
          if (messages.length) {
            errorMessage = `提交失败，请稍后再试。${messages.join('；')}`;
          }
        }
      } catch {
        errorMessage = '提交失败，请稍后再试';
      }
      setSubmitError(errorMessage);
    } catch {
      setSubmitError('提交失败，请稍后再试。');
    } finally {
      setIsSubmitting(false);
    }
  }

  useEffect(() => {
    if (!feedbackOpen) return;
    const timer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 80);
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeFeedbackModal();
    };
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [feedbackOpen]);

  useEffect(() => {
    if (!toastOpen) return;
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToastOpen(false);
      toastTimerRef.current = null;
    }, 2500);
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    };
  }, [toastOpen]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIntroReady(true);
    }, 50);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 768px)');
    const syncState = () => {
      setIsMobileViewport(query.matches);
      setMobileRouteListOpen(!query.matches);
    };
    syncState();
    query.addEventListener('change', syncState);
    return () => query.removeEventListener('change', syncState);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const shouldLockScroll = historyOpen || feedbackOpen || (isMobileViewport && drawerOpen);
    if (shouldLockScroll) {
      if (bodyOverflowRef.current === null) {
        bodyOverflowRef.current = document.body.style.overflow;
      }
      document.body.style.overflow = 'hidden';
      return () => {
        if (!historyOpen && !feedbackOpen && !(isMobileViewport && drawerOpen) && bodyOverflowRef.current !== null) {
          document.body.style.overflow = bodyOverflowRef.current;
          bodyOverflowRef.current = null;
        }
      };
    }

    if (bodyOverflowRef.current !== null) {
      document.body.style.overflow = bodyOverflowRef.current;
      bodyOverflowRef.current = null;
    }
  }, [drawerOpen, feedbackOpen, historyOpen, isMobileViewport]);

  return (
    <div className={`app-shell page-intro ${introReady ? 'is-ready' : ''}`}>
      <aside className="left-sidebar glass-panel">
        <div className="brand-block">
          <div className="brand-copy">
            <h1 className="brand-title">Camino Atlas · 朝圣路书</h1>
            <p className="brand-subtitle">选择你的朝圣之路，放进贝壳袋</p>
          </div>
          <div className="brand-actions">
            <button
              className="header-icon-button history-entry-button"
              onClick={() => setHistoryOpen(true)}
              type="button"
              aria-label="朝圣之路简史"
            >
              <span className="header-icon-button-icon">
                <img
                  className="history-entry-icon-image"
                  src="/geo/icons/book5.png"
                  alt="朝圣之路简史"
                />
              </span>
            </button>
            <button
              className="shell-bag-entry-icononly"
              onClick={() => setDrawerOpen(true)}
              type="button"
              aria-label="打开贝壳袋"
            >
              <span className="shell-bag-icon">
                <img
                  className="shell-bag-custom-icon"
                  src="/geo/icons/shell.png"
                  alt=""
                  aria-hidden="true"
                />
              </span>
              <span className="shell-bag-count">{favoriteIds.length}</span>
            </button>
          </div>
        </div>

        <div className="sidebar-scroll-region">
          <button
            type="button"
            className="mobile-route-toggle"
            onClick={() => setMobileRouteListOpen((prev) => !prev)}
            aria-expanded={mobileRouteListOpen}
            aria-controls="mobile-route-list-panel"
          >
            {mobileRouteListOpen ? '收起路线列表' : '查看路线列表'}
          </button>

          <div
            id="mobile-route-list-panel"
            className={`mobile-route-list-panel ${mobileRouteListOpen ? 'open' : ''}`}
          >
            <RouteList
              groups={groups}
              variantsById={variantsById}
              selectedGroupId={activeGroupId}
              selectedVariantId={selectedVariantId}
              favoriteIds={favoriteIds}
              switchingVariantId={isRouteSwitching ? selectedVariantId : null}
              onSelectGroup={(groupId) => {
                handleSelectGroup(groupId);
                if (window.matchMedia('(max-width: 768px)').matches) {
                  setMobileRouteListOpen(false);
                }
              }}
              onSelectVariant={(variantId) => {
                handleSelectVariant(variantId);
                if (window.matchMedia('(max-width: 768px)').matches) {
                  setMobileRouteListOpen(false);
                }
              }}
            />
            <div className="mobile-route-panel-footer">
              <span className="sidebar-footer-copy">Camino Atlas {"\u00A9"} AREN {"\u00D7"} LAN</span>
              <button className="feedback-link" type="button" onClick={openFeedbackModal}>
                <span className="feedback-link-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" role="img">
                    <path
                      d="M4 7.2A2.2 2.2 0 0 1 6.2 5h11.6A2.2 2.2 0 0 1 20 7.2v9.6a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 16.8V7.2Zm1.4.2 6.6 5.1 6.6-5.1"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="feedback-link-text">反馈 / 纠错</span>
              </button>
            </div>
          </div>
        </div>

        <div className="sidebar-footer">
          <span className="sidebar-footer-copy">Camino Atlas {"\u00A9"} AREN {"\u00D7"} LAN</span>
          <button className="feedback-link" type="button" onClick={openFeedbackModal}>
            <span className="feedback-link-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="img">
                <path
                  d="M4 7.2A2.2 2.2 0 0 1 6.2 5h11.6A2.2 2.2 0 0 1 20 7.2v9.6a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 16.8V7.2Zm1.4.2 6.6 5.1 6.6-5.1"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="feedback-link-text">反馈 / 纠错</span>
          </button>
        </div>
      </aside>

      <main className="right-main">
        <section className="map-area glass-panel">
          <MapView
            variant={selectedVariant}
            selectedVariantId={selectedVariantId}
            renderedVariantId={renderedVariantId}
            onRenderedVariantChange={(nextRenderedVariantId) => {
              setRenderedVariantId((prev) =>
                prev === nextRenderedVariantId ? prev : nextRenderedVariantId,
              );
            }}
          />
        </section>
        <section className="detail-area glass-panel">
          <RouteDetail
            group={selectedGroup}
            variant={selectedVariant}
            isFavorite={selectedVariant ? favoriteIds.includes(selectedVariant.id) : false}
            compactFavoriteLabel={isMobileViewport}
            onToggleFavorite={toggleFavorite}
          />
        </section>
      </main>

      <FavoritesDrawer
        open={drawerOpen}
        favoriteIds={favoriteIds}
        variantsById={variantsById}
        groupsById={groupsById}
        onClose={closeDrawer}
        onSelectVariant={(variantId) => {
          handleSelectVariant(variantId);
          closeDrawer();
        }}
        onRemoveFavorite={toggleFavorite}
        onClearAll={() => setFavoriteIds([])}
      />

      <CaminoHistoryModal open={historyOpen} onClose={closeHistoryModal} />

      <div className={`feedback-modal-root ${feedbackOpen ? 'open' : ''}`} aria-hidden={!feedbackOpen}>
        <button
          className="feedback-modal-backdrop"
          type="button"
          onClick={closeFeedbackModal}
          aria-label="关闭反馈弹窗"
        />
        <section className="feedback-modal-panel" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
          <header className="feedback-modal-header">
            <h3 id="feedback-title">反馈 / 纠错</h3>
            <p>发现路线信息、文案或地图显示问题，可以在这里告诉我。</p>
          </header>
          <form className="feedback-form" onSubmit={handleFeedbackSubmit}>
            <label className="feedback-field">
              <span>反馈类型</span>
              <select
                disabled={isSubmitting}
                value={feedbackForm.feedbackType}
                onChange={(event) =>
                  setFeedbackForm((prev) => ({ ...prev, feedbackType: event.target.value }))
                }
              >
                <option value="信息有误">信息有误</option>
                <option value="文案建议">文案建议</option>
                <option value="地图/显示问题">地图/显示问题</option>
                <option value="其他">其他</option>
              </select>
            </label>

            <label className="feedback-field">
              <span>具体内容</span>
              <textarea
                ref={textareaRef}
                disabled={isSubmitting}
                value={feedbackForm.detail}
                onChange={(event) =>
                  setFeedbackForm((prev) => ({ ...prev, detail: event.target.value }))
                }
                placeholder="请描述你看到的问题或建议（必填）"
              />
              {detailError ? <p className="feedback-error">{detailError}</p> : null}
            </label>

            <label className="feedback-field">
              <span>联系方式</span>
              <input
                type="text"
                disabled={isSubmitting}
                value={feedbackForm.contact}
                onChange={(event) =>
                  setFeedbackForm((prev) => ({ ...prev, contact: event.target.value }))
                }
                placeholder="选填，方便我回访"
              />
            </label>

            {submitError ? <p className="feedback-error">{submitError}</p> : null}

            <div className="feedback-actions">
              <button
                type="button"
                className="feedback-cancel-btn"
                onClick={closeFeedbackModal}
                disabled={isSubmitting}
              >
                取消
              </button>
              <button type="submit" className="feedback-submit-btn" disabled={isSubmitting}>
                {isSubmitting ? '提交中...' : '提交反馈'}
              </button>
            </div>
          </form>
        </section>
      </div>

      <div className={`feedback-toast ${toastOpen ? 'show' : ''}`} role="status" aria-live="polite">
        反馈已提交，谢谢你帮助完善 Camino Atlas。
      </div>
    </div>
  );
}
