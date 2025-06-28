// Cambiamos a la sintaxis de ES modules para las importaciones
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import readline from 'readline';

// Obtenemos __dirname en ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Crear interfaz para leer entrada del usuario
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Función para preguntar al usuario
const preguntarContinuar = () => {
    return new Promise((resolve) => {
        rl.question('¿Desea continuar con la iteración? (s/n): ', (respuesta) => {
            resolve(respuesta.toLowerCase() === 's');
        });
    });
};

/**
 * Función para hacer scraping de streamtpglobal.com
 */
async function scrapeStreamTpGlobal(page) {
    console.log('Obteniendo datos de StreamTpGlobal...');
    
    try {
        const response = await page.goto('https://streamtpglobal.com/eventos.json', {
            waitUntil: 'networkidle2'
        });

        const eventsData = await response.json();
        console.log(`StreamTpGlobal: ${eventsData.length} eventos obtenidos`);
        
        return eventsData.map(event => ({
            ...event,
            source: 'streamtpglobal'
        }));
    } catch (error) {
        console.error('Error al obtener datos de StreamTpGlobal:', error);
        return [];
    }
}

/**
 * Función para hacer scraping de alangulotv.live
 */
async function scrapeAlanGuloTV(page) {
    console.log('Obteniendo datos de AlanGuloTV...');
    
    try {
        await page.goto('https://alangulotv.live/agenda-2/', {
            waitUntil: 'networkidle2'
        });

        // Esperar a que los elementos se carguen
        await page.waitForSelector('.match-container', { timeout: 10000 });

        const events = await page.evaluate(() => {
            const matchContainers = document.querySelectorAll('.match-container');
            const events = [];

            matchContainers.forEach(container => {
                try {
                    // Extraer la hora
                    const timeElement = container.querySelector('.time');
                    const time = timeElement ? timeElement.textContent.trim() : '00:00';

                    // Extraer nombres de equipos
                    const teamNames = container.querySelectorAll('.team-name');
                    const team1 = teamNames[0] ? teamNames[0].textContent.trim() : '';
                    const team2 = teamNames[1] ? teamNames[1].textContent.trim() : '';
                    
                    // Crear título del evento
                    const title = team1 && team2 ? `${team1} vs ${team2}` : 'Evento sin título';

                    // Extraer enlaces
                    const linksContainer = container.nextElementSibling;
                    const links = [];
                    
                    if (linksContainer && linksContainer.classList.contains('links-container')) {
                        const linkButtons = linksContainer.querySelectorAll('.link-button');
                        linkButtons.forEach(button => {
                            const href = button.getAttribute('href');
                            if (href) {
                                // Convertir la URL relativa a absoluta
                                const fullUrl = href.startsWith('/') 
                                    ? `https://alangulotv.live${href}` 
                                    : href;
                                links.push(fullUrl);
                            }
                        });
                    }

                    // Solo agregar eventos que tengan al menos un enlace
                    if (links.length > 0) {
                        // Crear un evento por cada enlace (manteniendo compatibilidad con el formato actual)
                        links.forEach(link => {
                            events.push({
                                time: time,
                                title: title,
                                link: link,
                                category: 'Deportes',
                                language: 'Español',
                                date: new Date().toISOString().split('T')[0],
                                status: 'Próximo',
                                source: 'alangulotv'
                            });
                        });
                    }
                } catch (error) {
                    console.error('Error procesando contenedor de evento:', error);
                }
            });

            return events;
        });

        console.log(`AlanGuloTV: ${events.length} eventos obtenidos`);
        return events;
    } catch (error) {
        console.error('Error al obtener datos de AlanGuloTV:', error);
        return [];
    }
}

/**
 * Función principal para realizar el web scraping de ambas páginas.
 */
async function scrapeAllSources() {
    console.log('Iniciando el scrapper para ambas fuentes...');
    let browser;

    try {
        // Lanzar una instancia del navegador Chromium
        browser = await puppeteer.launch({
            args: [
                ...chromium.args,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        // Configurar user agent para evitar bloqueos
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        // Hacer scraping de ambas fuentes
        const [streamTpEvents, alanGuloEvents] = await Promise.all([
            scrapeStreamTpGlobal(page),
            scrapeAlanGuloTV(page)
        ]);

        // Combinar los eventos de ambas fuentes
        const allEvents = [...streamTpEvents, ...alanGuloEvents];
        
        // Guardar los datos en un archivo JSON
        const filePath = join(__dirname, 'events.json');
        const jsonData = JSON.stringify(allEvents, null, 2);
        
        await fs.writeFile(filePath, jsonData);
        console.log(`Scrapping completado. Total: ${allEvents.length} eventos guardados en events.json`);
        console.log(`- StreamTpGlobal: ${streamTpEvents.length} eventos`);
        console.log(`- AlanGuloTV: ${alanGuloEvents.length} eventos`);

        return allEvents;

    } catch (error) {
        console.error('Ocurrió un error durante el scrapping:', error);
        return null;
    } finally {
        if (browser) {
            console.log('Cerrando el navegador...');
            await browser.close();
        }
    }
}

async function main() {
    do {
        await scrapeAllSources();
        const continuar = await preguntarContinuar();
        if (!continuar) {
            break;
        }
    } while (true);
    
    rl.close();
    console.log('Programa finalizado.');
}

// Ejecutar la función principal
main();