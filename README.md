# PokéDash

Dashboard gratuit pour suivre ton business de cartes Pokémon : stock, lots, grading, ventes, marge et évolution. Il marche sur PC et sur téléphone, et peut s'installer comme une app.

- **Hébergement** : GitHub Pages (gratuit)
- **Base de données** : Supabase, offre gratuite (500 Mo, largement suffisant)
- **Sans build** : HTML, CSS et JS purs. Tu peux tout modifier avec Claude Code sans rien installer.

## Ce que ça fait

| Page | Contenu |
| --- | --- |
| Tableau de bord | Chiffres de l'achat-revente uniquement : bénéfice si tout est vendu, trésorerie, valeur du stock (cartes brutes, au grading, gradées, scellé), ventes, dépenses, rotation, taux de 10. Courbe d'évolution, résultat par mois et par lot, liste « À faire » |
| Stock revente | 4 onglets : **Cartes brutes**, **Scellé** (avec quantité et plus-value), **Gradées** (note, certificat, gain du grading), **Vendus** (marge) |
| Grading | **En cours** (retour prévu), **Candidates**, **Mes gradeurs** (délai réel, taux de 10, gain moyen par gradeur), **Simulateur** PCA / CCC / PSA côte à côte |
| Lots | Chaque achat de lot avec son résultat et son ROI calculés automatiquement |
| Ma collection | Tes cartes, scellés et gradées perso, avec leur valeur et leur évolution. **Jamais comptés** dans les chiffres d'achat-revente |
| Réglages | Seuils de la stratégie, tarifs et délais des gradeurs (PCA, CCC, PSA, CGC), thème, export JSON/CSV, import |

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

- **Tu achètes un lot** : « + Lot » (nom, source, prix, date).
- **Tu ajoutes un article** : « + Ajouter », puis choisis Carte à revendre, Produit scellé, Carte gradée, ou un article de **ma collection**. Une carte qui vient d'un lot se rattache au lot (son coût est déjà compté dans le prix du lot).
- **Scellé** : une seule ligne avec la quantité (ex. 3 × ETB). Quand tu en vends une partie, choisis « Vendue » et indique la quantité vendue : le reste reste en stock.
- **Tu envoies au grading** : statut « Au grading », choisis le gradeur et la formule. Les frais (CCC selon la valeur déclarée) et la date de retour prévue se calculent tout seuls.
- **La carte revient** : statut « Gradée (en main) », note et n° de certificat. Le gain du grading est calculé (cote gradée − cote brute à l'envoi − frais).
- **Tu vends** : remplis le prix de vente. Sur Cardmarket, les 5 % de frais sont préremplis.

La valeur du stock et celle de ta collection sont enregistrées chaque jour où tu ouvres le dashboard, ce qui construit les courbes d'évolution.

**Mise à jour v2** : si ta base Supabase a été créée avant la v2, relance tout `schema.sql` dans SQL Editor (sans danger, ça ajoute seulement les nouvelles colonnes).

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
