// Cambiamos a la sintaxis de ES modules para las importaciones
import puppeteer from 'puppeteer-core'; // Changed to puppeteer-core
import chromium from '@sparticuz/chromium'; // Import chromium
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
 * Función principal para realizar el web scraping.
 * Esta función es asíncrona para poder usar las capacidades de Puppeteer.
 */
async function scrapeStreamTpGlobal() {
    console.log('Iniciando el scrapper...');
    let browser; // Definimos la variable del navegador fuera del try/catch para acceder a ella en el finally

    try {
        // 1. Lanzar una instancia del navegador Chromium.
        browser = await puppeteer.launch({
            args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'], // Use chromium args
            executablePath: await chromium.executablePath(), // Specify the executable path
            headless: chromium.headless, // Use chromium's headless setting
        });

        const page = await browser.newPage();
        
        // 3. Navegar a la URL especificada y esperar a que la red esté inactiva.
        console.log('Obteniendo datos de eventos...');
        const response = await page.goto('https://streamtpglobal.com/eventos.json', {
            waitUntil: 'networkidle2'
        });

        const eventsData = await response.json();
        
        // 6. Guardar los datos en un archivo JSON.
        // __dirname es una variable global en Node.js (con CommonJS) que da la ruta de la carpeta actual.
        const filePath = join(__dirname, 'events.json');
        const jsonData = JSON.stringify(eventsData, null, 2); 
        
        await fs.writeFile(filePath, jsonData);
        console.log(`Scrapping completado. ${eventsData.length} eventos guardados en events.json`);

        return eventsData;

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
        await scrapeStreamTpGlobal();
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