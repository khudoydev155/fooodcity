import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ImagePlus, Pencil, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { apiDelete, apiGet, apiPost, apiPut, apiUploadPromotionImage } from './api';
import type { AdminCtx } from './types';
import './promotions.css';

interface PromoRecord {
  id: string;
  kind: 'story' | 'banner';
  title_uz: string;
  title_ru: string;
  title_en: string;
  subtitle_uz: string;
  subtitle_ru: string;
  subtitle_en: string;
  image_url: string;
  link_url: string | null;
  sort_order: number;
  is_active: boolean;
}

type PromoDraft = Omit<PromoRecord, 'id'>;

const emptyDraft = (): PromoDraft => ({
  kind: 'banner',
  title_uz: '',
  title_ru: '',
  title_en: '',
  subtitle_uz: '',
  subtitle_ru: '',
  subtitle_en: '',
  image_url: '',
  link_url: '',
  sort_order: 0,
  is_active: true
});

export function Promotions({ ctx }: { ctx: AdminCtx }) {
  const [records, setRecords] = useState<PromoRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PromoDraft>(emptyDraft);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  async function loadPromotions(): Promise<void> {
    setLoading(true);
    setLoadError('');
    try {
      const data = await apiGet<PromoRecord[]>('/api/admin/promotions');
      if (!Array.isArray(data)) throw new Error("Promolar noto'g'ri formatda keldi");
      setRecords(data);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Promolarni yuklab bo'lmadi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadPromotions(); }, []);

  function resetForm(): void {
    setDraft(emptyDraft());
    setImageFile(null);
    setEditingId(null);
  }

  function editPromo(promo: PromoRecord): void {
    setEditingId(promo.id);
    setDraft({ ...promo });
    setImageFile(null);
    document.querySelector('.promo-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function savePromo(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!draft.title_uz.trim()) {
      ctx.showToast("O'zbekcha nomni kiriting", 'error');
      return;
    }
    if (!imageFile && !draft.image_url) {
      ctx.showToast('Banner yoki story uchun rasm tanlang', 'error');
      return;
    }

    setSaving(true);
    try {
      const image_url = imageFile
        ? (await apiUploadPromotionImage(imageFile)).image_url
        : draft.image_url;
      const payload = { ...draft, image_url, link_url: draft.link_url?.trim() || null };
      if (editingId) {
        await apiPut(`/api/admin/promotions/${editingId}`, payload);
      } else {
        await apiPost('/api/admin/promotions', payload);
      }
      ctx.showToast(editingId ? 'Promo yangilandi' : 'Promo qo‘shildi', 'success');
      resetForm();
      await loadPromotions();
    } catch (error) {
      ctx.showToast(error instanceof Error ? error.message : 'Saqlashda xatolik yuz berdi', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(promo: PromoRecord): Promise<void> {
    try {
      await apiPut(`/api/admin/promotions/${promo.id}`, { ...promo, is_active: !promo.is_active });
      ctx.showToast(promo.is_active ? 'Promo yashirildi' : 'Promo faollashtirildi', 'success');
      await loadPromotions();
    } catch (error) {
      ctx.showToast(error instanceof Error ? error.message : 'Holatni yangilab bo‘lmadi', 'error');
    }
  }

  async function deletePromo(promo: PromoRecord): Promise<void> {
    if (!window.confirm(`"${promo.title_uz}" promo butunlay o'chirilsinmi?`)) return;
    setDeletingId(promo.id);
    try {
      await apiDelete(`/api/admin/promotions/${promo.id}`);
      ctx.showToast('Promo o‘chirildi', 'success');
      if (editingId === promo.id) resetForm();
      await loadPromotions();
    } catch (error) {
      ctx.showToast(error instanceof Error ? error.message : "Promoni o'chirib bo'lmadi", 'error');
    } finally {
      setDeletingId(null);
    }
  }

  const sorted = [...records].sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.sort_order - b.sort_order
  );

  return (
    <div className="promo-admin">
      <header className="promo-admin-header">
        <div>
          <span className="promo-eyebrow">MIJOZ MINI APP</span>
          <h1>Stories & Banner</h1>
          <p>Bosh sahifadagi stories va aksiyalar bannerlarini boshqaring.</p>
        </div>
        <button className="btn btn-outline" onClick={() => void loadPromotions()} disabled={loading}>
          <RefreshCw size={16} /> Yangilash
        </button>
      </header>

      <div className="promo-admin-layout">
        <form className="promo-editor" onSubmit={savePromo}>
          <div className="promo-editor-heading">
            <div className="promo-editor-icon"><ImagePlus size={20} /></div>
            <div>
              <h2>{editingId ? 'Promoni tahrirlash' : 'Yangi promo joylash'}</h2>
              <p>Rasm yuklang, tartib va matnlarni belgilang.</p>
            </div>
            {editingId && <button type="button" className="promo-icon-btn" onClick={resetForm} aria-label="Tahrirlashni bekor qilish"><X size={18} /></button>}
          </div>

          <div className="promo-form-grid">
            <label className="promo-field">
              <span>Ko‘rinish turi</span>
              <select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as PromoDraft['kind'] })}>
                <option value="banner">Bosh sahifa banneri</option>
                <option value="story">Story</option>
              </select>
            </label>
            <label className="promo-field">
              <span>Ko‘rsatish tartibi</span>
              <input type="number" min="0" value={draft.sort_order}
                onChange={e => setDraft({ ...draft, sort_order: Number(e.target.value) })} />
            </label>
          </div>

          <label className="promo-field">
            <span>Rasm <small>JPG, PNG yoki WEBP · 12 MB gacha</small></span>
            <input className="promo-file-input" type="file" accept="image/jpeg,image/png,image/webp"
              onChange={e => setImageFile(e.target.files?.[0] || null)} />
          </label>
          {(previewUrl || draft.image_url) && (
            <div className={`promo-image-preview ${draft.kind}`} style={{ backgroundImage: `url("${previewUrl || draft.image_url}")` }}>
              <span>{draft.kind === 'story' ? 'Story ko‘rinishi' : 'Banner ko‘rinishi'}</span>
            </div>
          )}

          <div className="promo-locale-fields">
            <h3>Matnlar</h3>
            {(['uz', 'ru', 'en'] as const).map(locale => (
              <div className="promo-locale-row" key={locale}>
                <b>{locale.toUpperCase()}</b>
                <input aria-label={`${locale} sarlavha`} placeholder={locale === 'uz' ? 'Sarlavha (majburiy)' : 'Sarlavha'}
                  required={locale === 'uz'} value={draft[`title_${locale}`]}
                  onChange={e => setDraft({ ...draft, [`title_${locale}`]: e.target.value })} />
                <input aria-label={`${locale} izoh`} placeholder="Qisqa izoh"
                  value={draft[`subtitle_${locale}`]}
                  onChange={e => setDraft({ ...draft, [`subtitle_${locale}`]: e.target.value })} />
              </div>
            ))}
          </div>

          <label className="promo-field">
            <span>Havola <small>ixtiyoriy · https:// yoki tg://</small></span>
            <input type="text" placeholder="https://..." value={draft.link_url || ''}
              onChange={e => setDraft({ ...draft, link_url: e.target.value })} />
          </label>

          <label className="promo-active-toggle">
            <input type="checkbox" checked={draft.is_active}
              onChange={e => setDraft({ ...draft, is_active: e.target.checked })} />
            <span>Mini App’da ko‘rsatilsin</span>
          </label>

          <div className="promo-form-actions">
            {editingId && <button type="button" className="btn btn-outline" onClick={resetForm}>Bekor qilish</button>}
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><Upload size={16} /> Yuklanmoqda...</> : <><Plus size={16} /> {editingId ? 'Saqlash' : 'Joylash'}</>}
            </button>
          </div>
        </form>

        <section className="promo-library">
          <div className="promo-library-heading">
            <div><h2>Joylangan kontent</h2><p>{records.length} ta promo · faollar bosh sahifada ko‘rinadi</p></div>
            <span>{records.filter(item => item.is_active).length} faol</span>
          </div>
          {loading ? (
            <div className="promo-state">Kontent yuklanmoqda...</div>
          ) : loadError ? (
            <div className="promo-state promo-error" role="alert">
              <p>{loadError}</p><button className="btn btn-outline sm" onClick={() => void loadPromotions()}>Qayta urinish</button>
            </div>
          ) : sorted.length === 0 ? (
            <div className="promo-empty"><ImagePlus size={34} /><strong>Hozircha promo joylanmagan</strong><span>Bannerlar va story’lar mijozlarning bosh sahifasida ko‘rinadi.</span></div>
          ) : (
            <div className="promo-record-list">
              {sorted.map(promo => (
                <article className={`promo-record ${promo.is_active ? '' : 'inactive'}`} key={promo.id}>
                  <img src={promo.image_url} alt="" />
                  <div className="promo-record-info">
                    <div className="promo-record-meta">
                      <span className={`promo-kind ${promo.kind}`}>{promo.kind === 'story' ? 'STORY' : 'BANNER'}</span>
                      <span>#{promo.sort_order}</span>
                    </div>
                    <strong>{promo.title_uz}</strong>
                    <small>{promo.is_active ? 'Faol' : 'Yashirilgan'}</small>
                  </div>
                  <div className="promo-record-actions">
                    <button className="promo-icon-btn" title={promo.is_active ? 'Yashirish' : 'Faollashtirish'}
                      onClick={() => void toggleActive(promo)}>{promo.is_active ? '●' : '○'}</button>
                    <button className="promo-icon-btn" title="Tahrirlash" onClick={() => editPromo(promo)}><Pencil size={16} /></button>
                    <button className="promo-icon-btn danger" title="O‘chirish" disabled={deletingId === promo.id}
                      onClick={() => void deletePromo(promo)}><Trash2 size={16} /></button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
