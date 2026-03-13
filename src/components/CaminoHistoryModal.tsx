import { useEffect, useRef } from 'react';

type CaminoHistoryModalProps = {
  open: boolean;
  onClose: () => void;
};

const TIMELINE_ITEMS = [
  {
    title: '起源',
    paragraphs: [
      '9 世纪，圣雅各的墓在伊比利亚西北部被发现，圣地亚哥由此成为西欧最重要的朝圣终点之一，常与耶路撒冷、罗马并提。真正使它扩张的，是 11 至 13 世纪王权、教廷与修会的合力推动。来自欧洲各地的朝圣者徒步、骑马或乘船赶赴这里。',
      '朝圣既是敬圣与赎罪，也是将信仰落实于身体的远行：离家，忍耐，行走，然后抵达。',
    ],
  },
  {
    title: '北线在先，法国之路后来居上',
    paragraphs: [
      '更早成形的是北方诸路线，它们与墓葬发现、早期王国的扶持密切相关，是雅各伯朝圣最初的骨架。11 世纪后，法国之路逐渐超越，成为最主要的朝圣通道。',
      '今天人们最熟悉的 Camino Francés，并非最古老的一条，却是后来最成熟、最具代表性的一条。',
    ],
  },
  {
    title: '中世纪黄金时代',
    paragraphs: [
      '朝圣的繁盛，不只是行路的人数，而是沿线生长出的整套世界：桥梁、医院、旅舍、集镇，以及接待陌生人的制度与人情。',
      '朝圣之路既承载信仰，也推动城市生长与文化流动。这条路从不只是通往圣地的路，而是一条曾真实塑造过欧洲空间与生活方式的路。',
    ],
  },
  {
    title: '衰落与沉寂',
    paragraphs: [
      '战争、瘟疫、宗教格局的变迁，以及现代交通的兴起，共同削弱了传统朝圣。许多路段并未消失，却从欧洲最重要的远行主道，悄悄退回为地方性的记忆与旧路径。',
      '也正因为曾经沉寂，后来的复兴才显得格外鲜明。',
    ],
  },
  {
    title: '近现代复兴',
    paragraphs: [
      '20 世纪中后期，协会与宗教纪念活动逐步唤回了人们对这条路的关注。随后，圣地亚哥老城列入世界遗产，圣雅各之路获认证为欧洲文化路线。',
      '这些认证重新赋予 Camino 一重身份：不再只属于宗教史，也属于欧洲文化史、旅行史与公共记忆。',
    ],
  },
  {
    title: '制度与仪式',
    paragraphs: [
      'Camino 得以跨世纪延续，有一个很实际的原因：它把完成一段路变成了极具仪式感的事。Credencial（朝圣者护照）一路盖章，记录你确实走过。',
      '终点的 Compostela 依旧保持古老的庄重。步行最后 100 公里或骑行 200 公里，即可申请这份证书。正是这套制度与礼仪，让走过成为被确认、被见证的完成。',
    ],
  },
  {
    title: '流行文化与现代想象',
    paragraphs: [
      'Paulo Coelho 的《朝圣》（The Pilgrimage）把这条路写成内在转变的起点，电影《朝圣之路》则让更多人意识到，它同样可以书写失去、和解与重新理解自己。',
      '于是今天出发的理由早已不止关乎宗教。有人为信仰，有人为徒步，有人为了停下来想一想，为了失恋、转职、独处，或只是想认真走完一段路。它古老，却不陈旧；有宗教根基，却始终向更广阔的人敞开。',
    ],
  },
  {
    title: '今天的 Camino',
    paragraphs: [
      '朝圣办公室至今仍在运转，仍为每一位符合条件的人发放 Compostela。Camino 从未停留在历史里，它仍在被真实的脚步与天气不断更新。',
      '今天的朝圣之路，当然仍通向那座城市、那座墓、那套延续千年的仪式；但也通向一个更私人的终点。当日子被压缩成每天的出发与再出发，你会慢慢明白，所谓抵达，从来不只是抵达一座城，也是终于抵达此刻的自己。',
    ],
  },
] as const;

export function CaminoHistoryModal({ open, onClose }: CaminoHistoryModalProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  return (
    <div className={`history-modal-root ${open ? 'open' : ''}`} aria-hidden={!open}>
      <button
        className="history-modal-backdrop"
        type="button"
        onClick={onClose}
        aria-label="关闭朝圣之路简史弹窗"
      />
      <section
        className="history-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-modal-title"
      >
        <header className="history-modal-header">
          <div className="history-modal-heading">
            <p className="history-modal-kicker">Camino History</p>
            <h3 id="history-modal-title">朝圣之路简史</h3>
            <p className="history-modal-subtitle">从宗教古道，到现代人身体与内心的修行之路</p>
          </div>
          <button type="button" className="history-modal-close" onClick={onClose} aria-label="关闭">
            <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6 6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="history-modal-body" ref={bodyRef}>
          <ol className="history-timeline">
            {TIMELINE_ITEMS.map((item) => (
              <li key={item.title} className="history-timeline-item">
                <span className="history-timeline-marker" aria-hidden="true" />
                <div className="history-timeline-content">
                  <h4>{item.title}</h4>
                  {item.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
