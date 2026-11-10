// ─────────────────────────────────────────────────────────────
//  Configuration PokéDash
//  Laisse vide pour le mode local (données dans ce navigateur seulement).
//  Remplis avec les infos de ton projet Supabase pour synchroniser
//  tes données sur tous tes appareils (voir README.md, étape 2).
//  La clé "anon" est publique par design : la sécurité est assurée
//  par les règles RLS du fichier schema.sql.
// ─────────────────────────────────────────────────────────────
export const SUPABASE_URL = "";
export const SUPABASE_ANON_KEY = "";

// Paramètres par défaut de la stratégie (modifiables dans Réglages)
export const DEFAULTS = {
  seuilGradingBrut: 20,      // € : en dessous, pas de grading
  multiplicateur10: 2.5,     // prix du 10 / prix brut minimum
  seuilPSA: 200,             // € : au-dessus, PSA plutôt que PCA
  joursAvantBaisse: 21,      // jours avant -10 % sur une carte en vente
  capitalDepart: 600,        // € : budget de départ
};
