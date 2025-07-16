import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
// Usar import para todos los paquetes, que es lo correcto para tu proyecto
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import UserDataDir from 'puppeteer-extra-plugin-user-data-dir';

// Aplicar los plugins de forma explícita para configurar el de user-data-dir
puppeteer.use(StealthPlugin());
puppeteer.use(UserDataDir({ deleteOnExit: false })); // Desactivar el borrado automático para evitar errores en Vercel

const DEFAULT_IMAGE = 'https://i.ibb.co/dHPWxr8/depete.jpg';

/**
 * Scrapea los links de cada evento de wearechecking.online
 */
async function fetchWACLinksForEvent(eventUrl) {
    try {
        const response = await fetch(eventUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            timeout: 15000
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const html = await response.text();
        const $ = cheerio.load(html);
        const options = [];
        $('.feed-buttons-wrapper .feed-button').each((i, btn) => {
            const onclick = $(btn).attr('onclick') || '';
            const match = onclick.match(/src = '([^']+)'/);
            const link = match ? match[1] : '';
            const name = $(btn).find('p').text().trim() || 'Canal';
            if (link) {
                options.push({ name, link });
            }
        });
        return options;
    } catch (error) {
        console.error('Error al obtener links de evento WAC:', eventUrl, error);
        return [];
    }
}

/**
 * Scrapea eventos en vivo de wearechecking.online/streams-pages/motorsports
 */
async function fetchWeAreCheckingMotorsportsEvents() {
    try {
        const url = 'https://wearechecking.online/streams-pages/motorsports';
        console.log('Fetching WeAreChecking Motorsports eventos desde', url);
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            timeout: 15000
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const html = await response.text();
        const $ = cheerio.load(html);
        const events = [];
        const eventPromises = [];
        $('#streams-dynamic-container .stream-wrapper').each((i, el) => {
            const $wrapper = $(el);
            // Extraer la imagen de la card actual
            const imageSrc = $wrapper.find('.stream-thumb').attr('src');
            let imageUrl = DEFAULT_IMAGE; // Usar imagen por defecto como fallback
            if (imageSrc) {
                // Construir la URL absoluta
                imageUrl = `https://wearechecking.online/${imageSrc.replace(/..[\\/]/, '')}`;
            }

            $wrapper.find('.stream-feed[onclick]').each((j, feedEl) => {
                const $feed = $(feedEl);
                const onclick = $feed.attr('onclick');
                const match = onclick ? onclick.match(/location.href='([^']+)'/) : null;
                const link = match ? `https://wearechecking.online${match[1]}` : '';
                const $p = $feed.find('p');
                if ($p.length === 0 || /No events/i.test($p.text())) return;
                let time = '-';
                let title = $p.text().trim();
                const $span = $p.find('.unix-timestamp');
                if ($span.length) {
                     let spanText = $span.text().replace(/ ￨ |\\|/g, '').trim();
                     time = spanText;
                     title = $p.text().replace($span.text(), '').replace(/^\s* ￨ \s*/, '').replace(/^\s*\|\s*/, '').trim();
                }
                const eventObj = {
                    time,
                    title,
                    link,
                    button: 'WAC',
                    category: 'Motor Sports',
                    language: 'Inglés',
                    date: new Date().toISOString().split('T')[0],
                    source: 'wearechecking-motorsports',
                    image: imageUrl, // Usar la imagen de la card
                    options: []
                };
                const p = fetchWACLinksForEvent(link).then(options => {
                    eventObj.options = options;
                    return eventObj;
                });
                eventPromises.push(p);
            });
        });
        const results = await Promise.all(eventPromises);
        return results.filter(ev => ev.options && ev.options.length > 0);
    } catch (error) {
        console.error('Error al obtener eventos de WeAreChecking Motorsports:', error);
        return [];
    }
}

/**
 * Función para generar delay aleatorio entre acciones
 */
function randomDelay(min = 1000, max = 3000) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Función para crear delay compatible con todas las versiones de Puppeteer
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Obtiene eventos desde la API de ppvs.su usando Puppeteer con mejor evasión
 */
async function fetchPpvSuEvents() {
    let browser = null;
    try {
        console.log('[PPVS.su] Iniciando Puppeteer con configuración avanzada...');
        
        // Configuración más robusta para evadir detección
        const launchOptions = {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                '--disable-backgrounding-occluded-windows',
                '--disable-ipc-flooding-protection',
                '--disable-client-side-phishing-detection',
                '--disable-component-extensions-with-background-pages',
                '--disable-extensions',
                '--disable-plugins',
                '--disable-images',
                '--disable-default-apps',
                '--disable-sync',
                '--disable-translate',
                '--hide-scrollbars',
                '--mute-audio',
                '--no-first-run',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=TranslateUI',
                '--disable-hang-monitor',
                '--disable-prompt-on-repost',
                '--disable-domain-reliability',
                '--disable-component-update',
                '--single-process',
                '--disable-gpu',
                '--disable-gpu-rasterization',
                '--disable-gpu-sandbox',
                '--disable-software-rasterizer',
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                '--disable-backgrounding-occluded-windows',
                '--disable-field-trial-config',
                '--disable-back-forward-cache',
                '--memory-pressure-off',
                '--max_old_space_size=4096'
            ],
            defaultViewport: {
                width: 1920,
                height: 1080,
                deviceScaleFactor: 1,
                hasTouch: false,
                isLandscape: true,
                isMobile: false,
            },
            executablePath: await chromium.executablePath(),
            headless: true,
            ignoreHTTPSErrors: true,
            ignoreDefaultArgs: ['--enable-automation'],
            timeout: 30000,
        };

        // Usar chromium args si están disponibles
        if (chromium.args) {
            launchOptions.args = [...chromium.args, ...launchOptions.args];
        }

        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();

        // Configurar headers y propiedades adicionales
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        await page.setExtraHTTPHeaders({
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        });

        // Ocultar propiedades de webdriver
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
            });
            
            // Eliminar propiedades de automatización
            delete navigator.__proto__.webdriver;
            
            // Modificar plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5],
            });
            
            // Modificar languages
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en'],
            });
        });

        // Navegar directamente a la API - más simple y rápido
        console.log('[PPVS.su] Navegando a la API...');
        const response = await page.goto('https://ppvs.su/api/streams', { 
            waitUntil: 'networkidle0', 
            timeout: 25000 
        });
        
        if (!response.ok()) {
             throw new Error(`PPVS.su API error: ${response.status()} ${response.statusText()}`);
        }

        // Esperar usando setTimeout nativo en lugar de page.waitForTimeout
        await delay(randomDelay(500, 1500));

        const jsonData = await page.evaluate(() => {
            const bodyText = document.querySelector('body').innerText;
            try {
                return JSON.parse(bodyText);
            } catch (e) {
                console.error('Error parsing JSON:', e);
                return null;
            }
        });
        
        if (!jsonData) {
            throw new Error('No se pudo parsear el JSON de la API');
        }

        console.log('[PPVS.su] Datos obtenidos exitosamente.');

        const categories = jsonData.streams;

        if (!Array.isArray(categories)) {
            console.error('PPVS.su: La propiedad "streams" no es un array como se esperaba.');
            return [];
        }

        const allPpvEvents = [];
        const now = Math.floor(Date.now() / 1000);

        categories.forEach(category => {
            if (Array.isArray(category.streams)) {
                category.streams.forEach(stream => {
                    if (stream.iframe) {
                        const eventDate = new Date(stream.starts_at * 1000);
                        let status = 'Desconocido';
                        if (stream.always_live === 1 || (now >= stream.starts_at && now <= stream.ends_at)) {
                            status = 'En vivo';
                        }
                        
                        allPpvEvents.push({
                            time: eventDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires', hour12: false }),
                            title: stream.name,
                            options: [stream.iframe],
                            buttons: [stream.tag || 'Ver'],
                            category: stream.category_name,
                            language: 'Inglés',
                            date: eventDate.toISOString().split('T')[0],
                            source: 'ppvsu',
                            image: stream.poster,
                            status: status,
                        });
                    }
                });
            }
        });

        console.log(`PPVS.su: ${allPpvEvents.length} eventos procesados exitosamente.`);
        return allPpvEvents;
    } catch (error) {
        console.error('Error al obtener eventos de PPVS.su:', error.message);
        return [];
    } finally {
        if (browser) {
            try {
                await browser.close();
                console.log('[PPVS.su] Navegador cerrado.');
            } catch (closeError) {
                console.error('Error al cerrar navegador:', closeError.message);
            }
        }
    }
}

/**
 * Función alternativa usando fetch directo con rotación de User-Agents
 */
async function fetchPpvSuEventsFallback() {
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0'
    ];

    try {
        console.log('[PPVS.su] Intentando fetch directo como fallback...');
        const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
        
        const response = await fetch('https://ppvs.su/api/streams', {
            headers: {
                'User-Agent': randomUA,
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            timeout: 15000
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const jsonData = await response.json();
        
        // Procesar los datos igual que en la función principal
        const categories = jsonData.streams;
        if (!Array.isArray(categories)) {
            return [];
        }

        const allPpvEvents = [];
        const now = Math.floor(Date.now() / 1000);

        categories.forEach(category => {
            if (Array.isArray(category.streams)) {
                category.streams.forEach(stream => {
                    if (stream.iframe) {
                        const eventDate = new Date(stream.starts_at * 1000);
                        let status = 'Desconocido';
                        if (stream.always_live === 1 || (now >= stream.starts_at && now <= stream.ends_at)) {
                            status = 'En vivo';
                        }
                        
                        allPpvEvents.push({
                            time: eventDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires', hour12: false }),
                            title: stream.name,
                            options: [stream.iframe],
                            buttons: [stream.tag || 'Ver'],
                            category: stream.category_name,
                            language: 'Inglés',
                            date: eventDate.toISOString().split('T')[0],
                            source: 'ppvsu',
                            image: stream.poster,
                            status: status,
                        });
                    }
                });
            }
        });

        console.log(`PPVS.su Fallback: ${allPpvEvents.length} eventos procesados.`);
        return allPpvEvents;
    } catch (error) {
        console.error('Error en fallback de PPVS.su:', error.message);
        return [];
    }
}

// --- FUNCIÓN PRINCIPAL EXPORTADA ---
export default async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        console.log('Iniciando obtención de eventos...');
        
        // Intentar primero con Puppeteer, si falla usar fallback
        let ppvSuEventsPromise = fetchPpvSuEvents().catch(async (error) => {
            console.log('Puppeteer falló, intentando fallback:', error.message);
            return await fetchPpvSuEventsFallback();
        });

        const [wacMotorsportsEvents, ppvSuEvents] = await Promise.allSettled([
            fetchWeAreCheckingMotorsportsEvents(),
            ppvSuEventsPromise
        ]);

        const wearecheckingMotorsportsEvents = wacMotorsportsEvents.status === 'fulfilled' ? wacMotorsportsEvents.value : [];
        const newPpvSuEvents = ppvSuEvents.status === 'fulfilled' ? ppvSuEvents.value : [];
        
        if (wacMotorsportsEvents.status === 'rejected') console.error('WeAreChecking Motorsports falló:', wacMotorsportsEvents.reason);
        if (ppvSuEvents.status === 'rejected') console.error('PPVS.su falló:', ppvSuEvents.reason);

        const allEvents = [...wearecheckingMotorsportsEvents, ...newPpvSuEvents];
        console.log(`Total eventos combinados: ${allEvents.length}`);
        
        if (allEvents.length === 0) {
            console.warn('No se obtuvieron eventos de ninguna fuente');
            return res.status(200).json([]);
        }
        
        const eventMap = new Map();
        allEvents.forEach(event => {
            if (!event || !event.title) return;

            const key = `${event.title || 'Sin título'}__${event.time || '-'}__${event.source}`;
            if (!eventMap.has(key)) {
                let buttonArr = [];
                let optionsArr = [];
                if (event.source === 'wearechecking-motorsports' && Array.isArray(event.options) && event.options.length > 0) {
                    buttonArr = event.options.map(opt => (opt.name || 'CANAL').toUpperCase());
                    optionsArr = event.options.map(opt => opt.link);
                } else if (event.source === 'ppvsu' && Array.isArray(event.options)) {
                    buttonArr = event.buttons;
                    optionsArr = event.options;
                } else if (event.button) {
                    buttonArr = [event.button];
                    optionsArr = [event.link];
                } else {
                    optionsArr = [event.link];
                }
                eventMap.set(key, {
                    time: event.time || '-',
                    title: event.title || 'Sin título',
                    options: optionsArr,
                    buttons: buttonArr,
                    category: event.category || 'Otros',
                    language: event.language || 'Desconocido',
                    date: event.date || new Date().toISOString().split('T')[0],
                    source: event.source || 'unknown',
                    image: event.image || '',
                    status: event.status || 'Desconocido'
                });
            } else {
                const existing = eventMap.get(key);
                if (event.source === 'wearechecking-motorsports' && Array.isArray(event.options)) {
                    event.options.forEach(opt => {
                        if (!existing.options.includes(opt.link)) {
                            existing.options.push(opt.link);
                            existing.buttons.push(opt.name.toUpperCase());
                        }
                    });
                } else if (event.link && !existing.options.includes(event.link)) {
                    existing.options.push(event.link);
                    if (event.button) existing.buttons.push(event.button);
                }
            }
        });

        let adaptedEvents = Array.from(eventMap.values());
        
        adaptedEvents = adaptedEvents.map(event => {
            if (!event.image) {
                event.image = DEFAULT_IMAGE;
            }
            return event;
        });
        
        return res.status(200).json(adaptedEvents);
    } catch (error) {
        console.error('Error en la función principal:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};