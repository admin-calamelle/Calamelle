import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import styles from './LandingPage.module.css';

const asset = (name) => `/assets/landing/${name}`;
const cx = (...names) => names.filter(Boolean).map((name) => styles[name]).join(' ');

export default function LandingPage() {
  const shellRef = useRef(null);
  const pageRef = useRef(null);
  const { user } = useAuth();
  const loginTarget = user ? '/app' : '/login';

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return undefined;

    const fitDesktopLanding = () => {
      // Use the real browser viewport, not a parent/container width.
      // This makes the 1440px Figma canvas fill the screen edge-to-edge.
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 1440;
      if (viewportWidth <= 900) {
        shell.style.removeProperty('--landing-scale');
        shell.style.removeProperty('--landing-height');
        return;
      }

      const scale = viewportWidth / 1440;
      shell.style.setProperty('--landing-scale', scale.toFixed(8));
      shell.style.setProperty('--landing-height', `${Math.ceil(3796 * scale)}px`);
    };

    fitDesktopLanding();
    window.addEventListener('resize', fitDesktopLanding, { passive: true });
    return () => window.removeEventListener('resize', fitDesktopLanding);
  }, []);

  useEffect(() => {
    const root = pageRef.current;
    if (!root) return undefined;

    const items = Array.from(root.querySelectorAll('[data-reveal]'));
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion || !('IntersectionObserver' in window)) {
      items.forEach((item) => item.classList.add(styles.revealed));
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add(styles.revealed);
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -6% 0px' });

    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={shellRef} className={styles.shell}>
      <main ref={pageRef} className={styles.page}>
        <section className={styles.top}>
          <div className={styles['hero-photo']} aria-hidden="true" />
          <div className={styles['wash-left']} aria-hidden="true" />
          <div className={styles['wash-bottom']} aria-hidden="true" />

          <nav className={styles.nav} aria-label="Navigation principale">
            <div className={styles['nav-left']}>
              <Link to="/" className={styles.brand} aria-label="Calamelle — accueil">
                <img src={asset('calamelle-mark.webp')} alt="" aria-hidden="true" />
                <span>Calamelle</span>
              </Link>
              <div className={styles.links}>
                <a href="#methode">La méthode</a>
                <a href="#examen">Examen civique</a>
                <a href="#offres">Offres</a>
                <a href="#culture">Culture</a>
                <a href="#avis">Avis</a>
              </div>
            </div>
            <div className={styles['nav-actions']}>
              <Link className={cx('pill', 'secondary')} to={loginTarget}>Se connecter</Link>
              <Link className={cx('pill', 'primary')} to="/register">Commencer gratuitement →</Link>
            </div>
          </nav>

          <div className={styles.hero}>
            <div className={styles['hero-copy']}>
              <div className={styles.kicker}>FRANÇAIS · CULTURE · HISTOIRE · CITOYENNETÉ</div>
              <h1>
                <span className={styles['title-dark']}>Le français,</span>
                <span className={styles['title-gold']}>dans toute sa<br />profondeur.</span>
              </h1>
              <p className={styles.desc}>
                Progressez un mot à la fois, préparez votre <b>examen civique</b><br />
                et découvrez <b>la France et ses valeurs</b> à travers une<br />
                méthode claire, bienveillante et efficace.
              </p>
              <Link className={cx('pill', 'primary', 'hero-cta')} to="/register">Commencer gratuitement →</Link>

              <div className={styles.stats} aria-label="Chiffres clés">
                <div className={styles.stat}><strong>2 441</strong><span>exercices expliqués</span></div>
                <div className={styles.stat}><strong>3</strong><span>niveaux de progression</span></div>
                <div className={styles.stat}><strong>40</strong><span>questions d’examen blanc</span></div>
              </div>

              <div className={styles.benefits}>
                <div className={styles.benefit}><span className={styles.check}>✓</span><span>Rejoignez-nous gratuitement</span></div>
                <div className={styles.benefit}><span className={styles.check}>✓</span><span>Progression locale</span></div>
                <div className={styles.benefit}><span className={styles.check}>✓</span><span>Une explication à chaque réponse</span></div>
              </div>
            </div>

            <div className={styles.qwrap}>
              <div className={styles.qcard}>
                <div className={styles.qeyebrow}>QUESTION DU JOUR<br /><span>CULTURE &amp; CITOYENNETÉ</span></div>
                <h3>Quelle est la devise de<br />la République française ?</h3>
                <div className={styles.answers}>
                  <div className={cx('answer', 'active')}><span className={styles.letter}>A</span><span>Liberté, Égalité, Fraternité</span></div>
                  <div className={styles.answer}><span className={styles.letter}>B</span><span>Travail, Famille, Patrie</span></div>
                  <div className={styles.answer}><span className={styles.letter}>C</span><span>Unité, Justice, Paix</span></div>
                </div>
                <div className={styles.explain}>
                  <div className={styles.bulb}><img src={asset('lightbulb.svg')} alt="" aria-hidden="true" /></div>
                  <div><strong>Comprendre, pas bachoter.</strong><span>Des explications claires pour mieux retenir.</span></div>
                </div>
              </div>
            </div>
          </div>
          <div className={styles.curve} aria-hidden="true" />
        </section>

        <section id="methode" className={cx('method', 'fixed')}>
          <div className={cx('method-copy', 'reveal')} data-reveal>
            <div className={styles.kicker}>UNE MÉTHODE QUI FAIT RETENIR</div>
            <h2>Apprendre,<br />comprendre, revoir<br />au bon moment.</h2>
            <p>Calamelle combine <b>exercices expliqués, parcours guidé</b><br />et <b>répétition espacée</b> afin que les notions ne<br />disparaissent pas après le quiz.</p>
          </div>
          <div className={cx('method-vis', 'reveal', 'reveal-delay-1')} data-reveal>
            <img src={asset('books-learning.webp')} alt="Livres Histoire, Citoyenneté et Langue française" loading="lazy" decoding="async" />
            <div className={styles['method-fade']} aria-hidden="true" />
            <div className={styles.step} style={{ top: 50 }}><span className={styles.n}>01</span><div><h3>Répondez</h3><p>Une question courte, claire, contextualisée.</p></div></div>
            <div className={styles.step} style={{ top: 163 }}><span className={styles.n}>02</span><div><h3>Comprenez</h3><p>Des explications simples qui transforment la<br />réponse en apprentissage.</p></div></div>
            <div className={styles.step} style={{ top: 276 }}><span className={styles.n}>03</span><div><h3>Retenez</h3><p>La répétition espacée ancre la notion dans votre<br />mémoire.</p></div></div>
          </div>
        </section>

        <section id="culture" className={cx('contents', 'fixed')}>
          <div className={cx('contents-head', 'reveal')} data-reveal>
            <div className={styles.kicker}>DES CONTENUS VARIÉS ET ACCESSIBLES</div>
            <div className={styles.intro}>
              <h2>Un parcours complet<br />pour progresser sereinement.</h2>
              <p>Tout ce qu’il vous faut pour <b>maîtriser le français</b> et<br /><b>réussir l’examen civique</b>, réuni dans un seul espace.</p>
            </div>
          </div>

          <div className={styles.grid}>
            <article className={cx('content-card', 'reveal')} data-reveal>
              <div className={styles['card-copy']}>
                <div className={styles['card-icon']}><img src={asset('book-open.svg')} alt="" aria-hidden="true" /></div>
                <h3>Langue française</h3>
                <p>Grammaire, vocabulaire, compréhension... Des explications claires et des exercices adaptés à votre niveau.</p>
                <a href="#offres">Découvrir →</a>
              </div>
              <img src={asset('notebook-pen.webp')} alt="Carnet d’apprentissage et plume" loading="lazy" decoding="async" />
            </article>

            <article className={cx('content-card', 'reveal', 'reveal-delay-1')} data-reveal>
              <div className={styles['card-copy']}>
                <div className={styles['card-icon']}><img src={asset('landmark.svg')} alt="" aria-hidden="true" /></div>
                <h3>Culture et histoire</h3>
                <p>Explorez l’histoire, la culture et les valeurs de la France à travers des contenus clairs et vivants.</p>
                <a href="#offres">Découvrir →</a>
              </div>
              <img src={asset('architecture-flag.webp')} alt="Architecture française et drapeau tricolore" loading="lazy" decoding="async" />
            </article>

            <article className={cx('content-card', 'reveal', 'reveal-delay-2')} data-reveal>
              <div className={styles['card-copy']}>
                <div className={styles['card-icon']}><img src={asset('users.svg')} alt="" aria-hidden="true" /></div>
                <h3>Citoyenneté</h3>
                <p>Institutions, droits, devoirs, vie démocratique... Tout pour comprendre la société française et réussir l’examen civique.</p>
                <a href="#offres">Découvrir →</a>
              </div>
              <img src={asset('marianne.webp')} alt="Allégorie de la citoyenneté française" loading="lazy" decoding="async" />
            </article>
          </div>
        </section>

        <section id="examen" className={cx('exam', 'fixed')}>
          <div className={styles['exam-bg']} aria-hidden="true" />
          <div className={cx('exam-copy', 'reveal')} data-reveal>
            <div className={styles.kicker}>PRÉPARATION EXAMEN</div>
            <h2>Un mode examen dédié.</h2>
            <p>Un entraînement chronométré de 40 questions, 45 minutes et un seuil<br />de réussite de 80 %, avec analyse par thème.</p>
            <Link className={cx('pill', 'secondary')} to="/app/civic-exam">Découvrir l’examen →</Link>
          </div>

          <div className={cx('exam-stats', 'reveal', 'reveal-delay-1')} data-reveal aria-label="Modalités de l’examen">
            <div className={styles['exam-stat']}><div className={styles['exam-ico']}><img src={asset('file-text.svg')} alt="" aria-hidden="true" /></div><strong>40</strong><span>questions</span></div>
            <div className={styles.divider} aria-hidden="true" />
            <div className={styles['exam-stat']}><div className={styles['exam-ico']}><img src={asset('clock.svg')} alt="" aria-hidden="true" /></div><strong>45</strong><span>minutes</span></div>
            <div className={styles.divider} aria-hidden="true" />
            <div className={styles['exam-stat']}><div className={styles['exam-ico']}><img src={asset('chart.svg')} alt="" aria-hidden="true" /></div><strong>80 %</strong><span>objectif de réussite</span></div>
          </div>
        </section>

        <section id="offres" className={cx('offers', 'fixed')}>
          <div className={cx('photo-wrap', 'reveal', 'reveal-delay-2')} data-reveal aria-hidden="true"><img src={asset('paris-arch.webp')} alt="" loading="lazy" decoding="async" /><div className={styles['photo-fade']} /></div>
          <div className={cx('offers-head', 'reveal')} data-reveal>
            <div className={styles.kicker}>COMMENCER LIBREMENT</div>
            <h2>Un socle gratuit<br />réellement utile.</h2>
            <p>Testez l’expérience <b>sans engagement</b>, puis passez à l’illimité lorsque vous en avez besoin.</p>
          </div>
          <img className={cx('ann1', 'reveal', 'reveal-delay-2')} data-reveal src={asset('annotation-today.webp')} alt="Apprendre aujourd’hui, construire demain." loading="lazy" decoding="async" />

          <div className={styles['offer-cards']}>
            <article className={cx('offer', 'reveal')} data-reveal>
              <div className={styles['offer-body']}>
                <h3>Version gratuite</h3>
                <div className={styles.price}><strong>0 €</strong></div>
                <ul><li><b>✓</b>20 nouvelles questions / jour</li><li><b>✓</b>Accès aux contenus essentiels</li><li><b>✓</b>Suivi de progression</li></ul>
              </div>
              <Link className={cx('pill', 'secondary')} to="/register">Commencer gratuitement →</Link>
            </article>

            <article className={cx('offer', 'annual', 'reveal', 'reveal-delay-1')} data-reveal>
              <div className={styles.popular}>LE PLUS POPULAIRE</div>
              <div className={styles['offer-body']}>
                <h3>Illimité annuel</h3>
                <div className={styles.price}><strong>34,99 €</strong><span>soit 2,92 €/mois</span></div>
                <ul><li><b>✓</b>Accès illimité à tous les contenus</li><li><b>✓</b>Mode examen complet</li><li><b>✓</b>Suivi de progression avancé</li><li><b>✓</b>Nouvelles questions chaque semaine</li></ul>
              </div>
              <Link className={cx('pill', 'primary')} to="/app/pricing">Voir toutes les offres →</Link>
            </article>
          </div>

          <img className={cx('ann2', 'reveal', 'reveal-delay-2')} data-reveal src={asset('annotation-exam.webp')} alt="Plus qu’un examen, une nouvelle étape." loading="lazy" decoding="async" />

          <div id="avis" className={cx('final', 'reveal')} data-reveal>
            <img src={asset('calamelle-mark.webp')} alt="" aria-hidden="true" />
            <div className={styles['final-copy']}><span>Petit pas après petit pas.</span><strong>Commencez aujourd’hui, progressez durablement.</strong></div>
            <Link className={cx('pill', 'secondary')} to="/register">Créer un compte →</Link>
          </div>
        </section>

        <div className={styles.gap} />

        <footer className={cx('footer', 'fixed', 'reveal')} data-reveal>
          <div className={styles['f-top']}>
            <div className={styles['f-brand']}>Calamelle</div>
            <div className={styles['f-links']}><a href="#methode">La méthode</a><a href="#examen">Examen civique</a><a href="#offres">Offres</a><a href="#culture">Culture</a><a href="#avis">Avis</a></div>
            <div className={styles['f-help']}><span>Aide</span><span>Contact</span><span><img src={asset('youtube.svg')} alt="YouTube" /></span><span><img src={asset('instagram.svg')} alt="Instagram" /></span></div>
          </div>
          <div className={styles['f-bottom']}><span>© 2026 Calamelle. Apprentissage, culture française et préparation à l’examen civique.</span><span>Conditions générales&nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;Confidentialité</span></div>
        </footer>
      </main>
    </div>
  );
}
