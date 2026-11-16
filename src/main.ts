import { BRAND } from './brand';
import './style.css';

function boot(): void {
  document.title = BRAND.gameName;

  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('Missing #app root element');

  // Placeholder title card. The real title screen arrives with the delivery loop (step 6).
  const card = document.createElement('main');
  card.className = 'title-card';

  const title = document.createElement('h1');
  title.textContent = BRAND.gameName;

  const tagline = document.createElement('p');
  tagline.className = 'tagline';
  tagline.textContent = BRAND.tagline;

  const app_ = document.createElement('p');
  app_.className = 'app-badge';
  app_.textContent = `Riding for ${BRAND.appName}`;

  card.append(title, tagline, app_);
  app.append(card);
}

boot();
