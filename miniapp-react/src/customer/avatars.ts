import type { Avatar } from './types';

export const AVATAR_KEY = 'user_avatar_id';

export const AVATARS: Avatar[] = [
  // Male avatars
  { id: 'm1', emoji: '👨', bg: 'linear-gradient(135deg, #667eea, #764ba2)', label: 'Erkak 1' },
  { id: 'm2', emoji: '🧑', bg: 'linear-gradient(135deg, #f093fb, #f5576c)', label: 'Erkak 2' },
  { id: 'm3', emoji: '👨‍💼', bg: 'linear-gradient(135deg, #4facfe, #00f2fe)', label: 'Biznesmen' },
  { id: 'm4', emoji: '👨‍🍳', bg: 'linear-gradient(135deg, #43e97b, #38f9d7)', label: 'Oshpaz' },
  { id: 'm5', emoji: '👨‍💻', bg: 'linear-gradient(135deg, #fa709a, #fee140)', label: 'Dasturchi' },
  { id: 'm6', emoji: '🧔', bg: 'linear-gradient(135deg, #a18cd1, #fbc2eb)', label: 'Soqolli' },
  { id: 'm7', emoji: '👨‍🎤', bg: 'linear-gradient(135deg, #ffecd2, #fcb69f)', label: 'Artist' },
  { id: 'm8', emoji: '🕵️', bg: 'linear-gradient(135deg, #2c3e50, #4ca1af)', label: 'Detektiv' },
  { id: 'm9', emoji: '👨‍🚀', bg: 'linear-gradient(135deg, #0f0c29, #302b63)', label: 'Astronavt' },
  { id: 'm10', emoji: '🤴', bg: 'linear-gradient(135deg, #f7971e, #ffd200)', label: 'Shahzoda' },
  // Female avatars
  { id: 'f1', emoji: '👩', bg: 'linear-gradient(135deg, #ff9a9e, #fad0c4)', label: 'Ayol 1' },
  { id: 'f2', emoji: '👩‍💼', bg: 'linear-gradient(135deg, #a1c4fd, #c2e9fb)', label: 'Biznesvumen' },
  { id: 'f3', emoji: '👩‍🍳', bg: 'linear-gradient(135deg, #84fab0, #8fd3f4)', label: 'Oshpaz ayol' },
  { id: 'f4', emoji: '👩‍💻', bg: 'linear-gradient(135deg, #d4fc79, #96e6a1)', label: 'Dasturchiga' },
  { id: 'f5', emoji: '👸', bg: 'linear-gradient(135deg, #f6d365, #fda085)', label: 'Malika' },
  { id: 'f6', emoji: '👩‍🎤', bg: 'linear-gradient(135deg, #89f7fe, #66a6ff)', label: 'Artistka' },
  { id: 'f7', emoji: '🧕', bg: 'linear-gradient(135deg, #fddb92, #d1fdff)', label: 'Hijobli' },
  { id: 'f8', emoji: '👩‍🔬', bg: 'linear-gradient(135deg, #e0c3fc, #8ec5fc)', label: 'Olima' },
  { id: 'f9', emoji: '🧙‍♀️', bg: 'linear-gradient(135deg, #1e3c72, #2a5298)', label: 'Sehrgar' },
  { id: 'f10', emoji: '🦸‍♀️', bg: 'linear-gradient(135deg, #ff6b6b, #feca57)', label: 'Superqahramon' },
];

export function getSelectedAvatar(): Avatar {
  const id = localStorage.getItem(AVATAR_KEY) || 'm1';
  return AVATARS.find(a => a.id === id) || AVATARS[0];
}

export function saveAvatar(avatarId: string): void {
  localStorage.setItem(AVATAR_KEY, avatarId);
}
