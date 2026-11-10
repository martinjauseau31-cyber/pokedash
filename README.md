# PokéDash

Dashboard gratuit pour suivre ton business de cartes Pokémon : stock, lots, grading, ventes, marge et évolution. Il marche sur PC et sur téléphone, et peut s'installer comme une app.

- **Hébergement** : GitHub Pages (gratuit)
- **Base de données** : Supabase, offre gratuite (500 Mo, largement suffisant)
- **Sans build** : HTML, CSS et JS purs. Tu peux tout modifier avec Claude Code sans rien installer.

## Ce que ça fait

| Page | Contenu |
| --- | --- |
| Tableau de bord | 8 KPI (résultat latent, ROI, valeur du stock, ventes, dépenses, rotation, part du stock au grading, taux de 9-10), courbe d'évolution, résultat par lot, résultat par mois, liste « À faire » |
| Stock | Toutes tes cartes avec recherche, filtres (statut, lot) et tri. Clique sur une ligne pour modifier ou supprimer. |
| Lots | Chaque achat de lot avec son résultat et son ROI calculés automatiquement |
| Grading | Cartes chez le gradeur, cartes candidates (cote ≥ seuil), notes reçues |
| Simulateur | Grader ou vendre brut : espérance de gain, pire cas, règle du 2,5× |
| Réglages | Seuils de la stratégie, thème clair ou sombre, export JSON/CSV, import |

La fiche de chaque carte affiche une recommandation tirée de la grille de tri. La liste « À faire » te signale les cartes en vente depuis plus de 21 jours (baisse de 10 %) et les cartes à inspecter pour le grading.

---

## 1. Mettre le site en ligne (GitHub Pages, 5 min)

1. Sur GitHub, crée un nouveau dépôt, par exemple `pokedash`.
   Le dépôt **public** est gratuit sur Pages. Tes données ne sont pas dans le code, elles restent dans Supabase et sont protégées par ton login.
2. Envoie les fichiers de ce dossier dans le dépôt :
   ```bash
   cd pokedash
   git init && git add . && git commit -m "PokéDash"
   git branch -M main
   git remote add origin https://github.com/<ton-pseudo>/pokedash.git
   git push -u origin main
   ```
   Tu peux aussi faire *Add file → Upload files* depuis l'interface GitHub.
3. Ouvre *Settings → Pages → Build and deployment*, choisis *Source : Deploy from a branch*, puis la branche `main` et le dossier `/ (root)`, et enregistre.
4. Après environ 1 minute, ton site est en ligne sur `https://<ton-pseudo>.github.io/pokedash/`.

Le site marche tout de suite en **mode local** : les données restent dans le navigateur où tu les saisis. Pour les retrouver sur tous tes appareils, fais l'étape 2.

## 2. Synchroniser sur tous tes appareils (Supabase, 10 min)

1. Crée un compte sur [supabase.com](https://supabase.com), puis *New project* (région conseillée : Paris ou Francfort, plan *Free*).
2. Dans *SQL Editor → New query*, colle tout le contenu de `schema.sql` et clique sur *Run*.
3. Dans *Project Settings → API*, copie le *Project URL* et la clé *anon public*.
4. Colle-les dans `config.js` :
   ```js
   export const SUPABASE_URL = "https://xxxx.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```
   La clé *anon* est faite pour être publique. La sécurité vient des règles RLS de `schema.sql` : chaque compte ne voit que ses propres données.
5. Dans *Authentication → URL Configuration*, mets ton URL GitHub Pages dans *Site URL*.
6. Fais un commit et un push. Recharge le site, clique sur **Créer un compte**, confirme ton e-mail, puis connecte-toi.

> Si tu avais déjà saisi des données en mode local : avant l'étape 4, fais *Réglages → Exporter (JSON)*, puis après connexion *Réglages → Importer (JSON)*.

> Sur l'offre gratuite, Supabase met en pause un projet resté sans activité pendant 7 jours. Il suffit de cliquer sur *Restore* dans le tableau de bord Supabase : aucune donnée n'est perdue. Si tu ouvres le dashboard au moins une fois par semaine, ça n'arrive pas.

## 3. Installer sur ton téléphone

Ouvre le site dans Safari (iPhone) ou Chrome (Android), puis *Partager → Sur l'écran d'accueil*. Il s'ouvre ensuite en plein écran, comme une app.

---

## Comment l'utiliser au quotidien

1. **Tu achètes un lot** : *+ Lot* (nom, source, prix, date).
2. **Tu tries le lot** : *+ Carte* pour chaque carte qui vaut plus de 2-3 €, en la rattachant au lot. Les petites cartes peuvent être groupées en une ligne « Lot 50 communes ».
3. **Tu mets en vente** : statut *En vente*. La date se remplit automatiquement et sert à l'alerte des 21 jours.
4. **Tu envoies en grading** : statut *Au grading*, avec la société et les frais.
5. **Tu vends** : tu remplis le prix de vente. Le statut passe en *Vendue* et, sur Cardmarket, les frais de 5 % sont préremplis.

La valeur du stock est enregistrée chaque jour où tu ouvres le dashboard, ce qui construit la courbe d'évolution.

## Modifier avec Claude Code

Tout est dans 4 fichiers :

| Fichier | Rôle |
| --- | --- |
| `app.js` | Logique, calculs, pages, graphiques |
| `style.css` | Design (couleurs dans `:root` en haut) |
| `config.js` | Connexion Supabase et seuils par défaut |
| `schema.sql` | Tables de la base de données |

Exemples de demandes : « ajoute un champ *photo* aux cartes », « ajoute une page *Wishlist* », « importe mon Google Sheet de stock en CSV ».
Pour tester en local : `python3 -m http.server`, puis ouvre `http://localhost:8000`.
