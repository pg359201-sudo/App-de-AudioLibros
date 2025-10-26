import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ResponseMode } from './types';
import { generateTextAnalysis, generateSpeech, translateText } from './services/geminiService';
import { UploadIcon } from './components/icons/UploadIcon';
import { SpinnerIcon } from './components/icons/SpinnerIcon';
import AudioPlayer from './components/AudioPlayer';
import { FileTextIcon } from './components/icons/FileTextIcon';
import { DownloadIcon } from './components/icons/DownloadIcon';
import { TranslateIcon } from './components/icons/TranslateIcon';

declare global {
    interface Window {
        pdfjsLib: any;
        lamejs: any;
    }
}

type AnalysisResults = {
    [key in ResponseMode]?: string;
};

/**
 * Creates a valid MP3 file Blob from raw PCM audio data using lamejs.
 * @param pcmData The raw PCM audio data as an ArrayBuffer (must be 16-bit).
 * @param sampleRate The sample rate of the audio (e.g., 24000).
 * @param numChannels The number of channels (e.g., 1 for mono).
 * @returns A Blob representing the complete MP3 file.
 */
const createMp3Blob = (pcmData: ArrayBuffer, sampleRate: number, numChannels: number): Blob => {
    const pcm = new Int16Array(pcmData);
    const mp3encoder = new window.lamejs.Mp3Encoder(numChannels, sampleRate, 128); // 128 kbps
    // Fix: Use BlobPart[] type to match Blob constructor requirements.
    const mp3Data: BlobPart[] = [];
    const sampleBlockSize = 1152;

    for (let i = 0; i < pcm.length; i += sampleBlockSize) {
        const sampleChunk = pcm.subarray(i, i + sampleBlockSize);
        const mp3buf = mp3encoder.encodeBuffer(sampleChunk);
        if (mp3buf.length > 0) {
            mp3Data.push(mp3buf);
        }
    }
    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
    }
    
    return new Blob(mp3Data, { type: 'audio/mpeg' });
};


const App: React.FC = () => {
    const [documentText, setDocumentText] = useState<string>('');
    const [fileName, setFileName] = useState<string>('');
    const [analysisResults, setAnalysisResults] = useState<AnalysisResults | null>(null);
    const [translatedResults, setTranslatedResults] = useState<AnalysisResults | null>(null);
    const [activeTab, setActiveTab] = useState<ResponseMode>(ResponseMode.Resumido);
    const [displayedLanguage, setDisplayedLanguage] = useState<'es' | 'en'>('es');
    const [audioSrc, setAudioSrc] = useState<string | null>(null);
    const [audioBlob, setAudioBlob] = useState<{ blob: Blob; lang: 'es' | 'en' } | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
    const [isGeneratingAudio, setIsGeneratingAudio] = useState<boolean>(false);
    const [generationProgress, setGenerationProgress] = useState<string | null>(null);
    const [isTranslating, setIsTranslating] = useState<boolean>(false);
    const [isParsingPdf, setIsParsingPdf] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [warning, setWarning] = useState<string | null>(null);
    const [isProcessed, setIsProcessed] = useState<boolean>(false);
    const [inputMode, setInputMode] = useState<'paste' | 'upload'>('paste');
    const [isPdfJsReady, setIsPdfJsReady] = useState(false);
    const [isLameJsReady, setIsLameJsReady] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    // Dynamic script loader for external libraries
    useEffect(() => {
        const loadScript = (src: string, onReady: () => void, onError: () => void) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = onReady;
            script.onerror = onError;
            document.body.appendChild(script);
            return () => { document.body.removeChild(script); };
        };

        // Load PDF.js
        if (!window.pdfjsLib) {
            loadScript(
                'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
                () => {
                    if (window.pdfjsLib) {
                        window.pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js`;
                        setIsPdfJsReady(true);
                    } else {
                        setError("La librería PDF se cargó, pero no se inicializó correctamente.");
                    }
                },
                () => {
                    setError("No se pudo cargar la librería para leer PDFs. Revisa tu conexión a internet.");
                }
            );
        } else {
            setIsPdfJsReady(true);
        }

        // Load LameJS
        if (!window.lamejs) {
            loadScript(
                'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js',
                () => setIsLameJsReady(true),
                () => setError("No se pudo cargar la librería de codificación de audio.")
            );
        } else {
            setIsLameJsReady(true);
        }
    }, []);

    const handleAnalysis = useCallback(async (text: string) => {
        if (!text.trim()) {
            setError('El documento no puede estar vacío.');
            return;
        }

        setIsAnalyzing(true);
        setError(null);
        setWarning(null);
        setAudioSrc(null);
        setAudioBlob(null);
        setAnalysisResults(null);
        setTranslatedResults(null);

        try {
            const modesToGenerate = [ResponseMode.Completo, ResponseMode.Resumido, ResponseMode.PuntosClave];
            const analysisPromises = modesToGenerate.map(mode => 
                generateTextAnalysis(text, mode)
            );
            
            const results = await Promise.all(analysisPromises);

            const newAnalysisResults: AnalysisResults = {
                [ResponseMode.Completo]: results[0],
                [ResponseMode.Resumido]: results[1],
                [ResponseMode.PuntosClave]: results[2],
            };
            
            setAnalysisResults(newAnalysisResults);
            setActiveTab(ResponseMode.Resumido);
            setDisplayedLanguage('es');
            setIsProcessed(true);

        } catch (e: any) {
            console.error(e);
            let errorMessage = 'Ocurrió un error al procesar el documento. Por favor, inténtalo de nuevo.';
             if (e?.message) {
                if (e.message.toLowerCase().includes('api key') || e.message.toLowerCase().includes('permission denied')) {
                    errorMessage = 'Error de autenticación. Por favor, verifica que la API Key esté configurada correctamente en el entorno de la aplicación.';
                } else if (e.message.toLowerCase().includes('token')) {
                    errorMessage = `El documento es demasiado grande y no se pudo procesar. Error: ${e.message}`;
                }
            }
            setError(errorMessage);
            setIsProcessed(false);
        } finally {
            setIsAnalyzing(false);
        }
    }, []);

    const handleTranslate = async (mode: ResponseMode) => {
        const spanishText = analysisResults?.[mode];
        if (!spanishText) {
            setError("No hay texto para traducir.");
            return;
        }

        setIsTranslating(true);
        setError(null);

        try {
            const translatedText = await translateText(spanishText);
            setTranslatedResults(prev => ({ ...prev, [mode]: translatedText }));
            setDisplayedLanguage('en');
        } catch (e) {
            console.error("Translation failed:", e);
            setError("No se pudo traducir el texto.");
        } finally {
            setIsTranslating(false);
        }
    };
    
    const splitTextIntoChunks = (text: string, maxLength: number): string[] => {
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [];

        if (sentences.length === 0) {
            if (text.length > maxLength) {
                const chunks: string[] = [];
                let i = 0;
                while (i < text.length) {
                    chunks.push(text.substring(i, i + maxLength));
                    i += maxLength;
                }
                return chunks;
            } else {
                return text ? [text] : [];
            }
        }

        const chunks: string[] = [];
        let currentChunk = "";

        for (const sentence of sentences) {
            const trimmedSentence = sentence.trim();
            if (trimmedSentence.length === 0) continue;

            if (trimmedSentence.length > maxLength) {
                if (currentChunk.length > 0) {
                    chunks.push(currentChunk);
                    currentChunk = "";
                }
                let i = 0;
                while (i < trimmedSentence.length) {
                    chunks.push(trimmedSentence.substring(i, i + maxLength));
                    i += maxLength;
                }
                continue;
            }
            
            if ((currentChunk + " " + trimmedSentence).length > maxLength) {
                chunks.push(currentChunk);
                currentChunk = trimmedSentence;
            } else {
                currentChunk += (currentChunk.length > 0 ? " " : "") + trimmedSentence;
            }
        }

        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }

        return chunks;
    };
    
    const handleGenerateAudio = async (mode: ResponseMode, language: 'es' | 'en') => {
        const textToSpeak = language === 'es' ? analysisResults?.[mode] : translatedResults?.[mode];

        if (!textToSpeak) {
            setError(`No hay texto en ${language === 'es' ? 'español' : 'inglés'} para generar el audio.`);
            return;
        }

        if (!isLameJsReady) {
            setError("La librería de codificación de audio no está lista. Por favor, inténtalo de nuevo en un momento.");
            return;
        }

        setIsGeneratingAudio(true);
        setError(null);
        setWarning(null);
        setAudioSrc(null);
        setAudioBlob(null);
        setGenerationProgress(null);

        try {
            const TTS_CHARACTER_LIMIT = 4800;
            let audioBase64Results: string[];

            if (textToSpeak.length <= TTS_CHARACTER_LIMIT) {
                setGenerationProgress('Generando audio (1/1)...');
                const singleResult = await generateSpeech(textToSpeak, language);
                audioBase64Results = [singleResult];
            } else {
                const chunks = splitTextIntoChunks(textToSpeak, TTS_CHARACTER_LIMIT);
                 if (chunks.length === 0) {
                     setWarning("No se pudo procesar el texto para generar audio.");
                     setIsGeneratingAudio(false);
                     return;
                }
                
                const totalChunks = chunks.length;
                const progressCounter = { completed: 0 };
                setGenerationProgress(`Generando audio (0/${totalChunks})...`);

                const promises = chunks.map(chunk =>
                    generateSpeech(chunk, language).then(result => {
                        progressCounter.completed++;
                        setGenerationProgress(`Generando audio (${progressCounter.completed}/${totalChunks})...`);
                        return result;
                    })
                );
                audioBase64Results = await Promise.all(promises);
            }

            setGenerationProgress('Procesando audio...');
            
            const arrayBuffers = audioBase64Results.map(b64 => {
                const byteCharacters = atob(b64);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                return new Uint8Array(byteNumbers).buffer;
            });

            const totalLength = arrayBuffers.reduce((acc, value) => acc + value.byteLength, 0);
            const combinedPcm = new Uint8Array(totalLength);
            let offset = 0;
            for (const buffer of arrayBuffers) {
                combinedPcm.set(new Uint8Array(buffer), offset);
                offset += buffer.byteLength;
            }

            const mp3Blob = createMp3Blob(combinedPcm.buffer, 24000, 1);
            const audioUrl = URL.createObjectURL(mp3Blob);
            setAudioSrc(audioUrl);
            setAudioBlob({ blob: mp3Blob, lang: language });

        } catch(e) {
            console.error("Audio generation failed:", e);
            setError("No se pudo generar el audio para este texto.");
        } finally {
            setIsGeneratingAudio(false);
            setGenerationProgress(null);
        }
    };
    
    const handleDownloadAudio = () => {
        if (!audioSrc || !audioBlob) return;
    
        const baseFileName = fileName 
            ? fileName.substring(0, fileName.lastIndexOf('.')) || fileName 
            : 'analisis-de-texto';
        
        const downloadFileName = `${baseFileName}_audio_${audioBlob.lang}.mp3`;
    
        const a = document.createElement('a');
        a.href = audioSrc;
        a.download = downloadFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const handleDownloadText = (mode: ResponseMode) => {
        const textToDownload = displayedLanguage === 'en' ? translatedResults?.[mode] : analysisResults?.[mode];
        if (!textToDownload) return;

        const blob = new Blob([textToDownload], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const fileName = `${mode.toLowerCase().replace(/\s+/g, '-')}-${displayedLanguage}.txt`;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };
    
    const handleReset = () => {
        setIsProcessed(false);
        setDocumentText('');
        setAnalysisResults(null);
        setTranslatedResults(null);
        setAudioSrc(null);
        setAudioBlob(null);
        setError(null);
        setWarning(null);
        setFileName('');
        setInputMode('paste');
        setActiveTab(ResponseMode.Resumido);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const extractTextFromPdf = async (file: File): Promise<string> => {
        const reader = new FileReader();
        return new Promise((resolve, reject) => {
            reader.onload = async (event) => {
                try {
                    const typedarray = new Uint8Array(event.target?.result as ArrayBuffer);
                    const pdf = await window.pdfjsLib.getDocument(typedarray).promise;
                    let fullText = '';
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const textContent = await page.getTextContent();
                        const pageText = textContent.items.map((item: { str: string }) => item.str).join(' ');
                        fullText += pageText + '\n\n';
                    }
                    resolve(fullText);
                } catch (error) {
                    reject('No se pudo extraer el texto del PDF. El archivo podría estar dañado o protegido.');
                }
            };
            reader.onerror = () => reject('Ocurrió un error al leer el archivo PDF.');
            reader.readAsArrayBuffer(file);
        });
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setError(null);
        setWarning(null);
        setFileName('');
        setDocumentText('');

        if (file.type === 'text/plain') {
            const reader = new FileReader();
            reader.onload = (e) => {
                setDocumentText(e.target?.result as string);
                setFileName(file.name);
            };
            reader.onerror = () => setError('Ocurrió un error al leer el archivo .txt.');
            reader.readAsText(file);
        } else if (file.type === 'application/pdf') {
            setIsParsingPdf(true);
            setFileName(file.name);
            try {
                const text = await extractTextFromPdf(file);
                setDocumentText(text);
            } catch (err: any) {
                setError(typeof err === 'string' ? err : 'Error desconocido al procesar el PDF.');
                setFileName('');
            } finally {
                setIsParsingPdf(false);
            }
        } else {
            setError('Por favor, sube un archivo .txt o .pdf.');
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const InputModeTab = ({ mode, label }: { mode: 'paste' | 'upload'; label: string }) => (
        <button
            onClick={() => setInputMode(mode)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                inputMode === mode
                    ? 'border-emerald-500 text-emerald-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
        >
            {label}
        </button>
    );

    const ResultTab = ({ mode, label }: { mode: ResponseMode; label: string }) => (
        <button
            onClick={() => { setActiveTab(mode); setAudioSrc(null); setAudioBlob(null); setWarning(null); setDisplayedLanguage('es'); }}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === mode
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            }`}
        >
            {label}
        </button>
    );

    const totalLoading = isAnalyzing || isParsingPdf;
    const loadingText = isParsingPdf ? 'Extrayendo texto del PDF...' : (isAnalyzing ? 'Analizando Documento...' : 'Analizar Documento');

    const currentTextToDisplay = displayedLanguage === 'en' ? translatedResults?.[activeTab] : analysisResults?.[activeTab];
    const isEnglishTranslated = !!translatedResults?.[activeTab];

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4 sm:p-6 lg:p-8">
            <div className="w-full max-w-3xl mx-auto">
                <header className="text-center mb-8">
                    <h1 className="text-3xl sm:text-4xl font-bold text-slate-900">Crea tus propios Audiolibros 📚🎧</h1>
                    <p className="mt-2 text-slate-600">Sube un documento, obtén múltiples análisis y escúchalos cuando quieras.</p>
                </header>

                <main className="bg-white rounded-xl shadow-lg p-6 sm:p-8">
                    {!isProcessed ? (
                        <div>
                            <div className="border-b border-slate-200 mb-4">
                                <div className="-mb-px flex space-x-4" aria-label="Tabs">
                                    <InputModeTab mode="paste" label="Pegar Texto" />
                                    <InputModeTab mode="upload" label="Subir Archivo" />
                                </div>
                            </div>
                            
                            {inputMode === 'paste' ? (
                                <textarea
                                    value={documentText}
                                    onChange={(e) => { setDocumentText(e.target.value); setFileName(''); }}
                                    placeholder="Escribe o pega aquí un texto largo..."
                                    className="w-full h-64 p-4 border border-slate-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500 transition duration-150"
                                    disabled={totalLoading}
                                />
                            ) : (
                                <div className="flex flex-col items-center justify-center w-full">
                                    {!isPdfJsReady ? (
                                        <div className="flex flex-col items-center justify-center w-full h-64 border-2 border-slate-300 border-dashed rounded-lg bg-slate-50">
                                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
                                            <p className="mt-2 text-sm text-slate-500">Inicializando lector de PDF...</p>
                                        </div>
                                    ) : (
                                        <label htmlFor="file-upload" className="flex flex-col items-center justify-center w-full h-64 border-2 border-slate-300 border-dashed rounded-lg cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors">
                                            <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                                <FileTextIcon />
                                                {fileName ? (
                                                    <p className="mb-2 text-sm text-slate-700 font-semibold">{fileName}</p>
                                                ) : (
                                                    <p className="mb-2 text-sm text-slate-500"><span className="font-semibold">Haz clic para subir</span> o arrastra y suelta</p>
                                                )}
                                                <p className="text-xs text-slate-500">Solo archivos .txt y .pdf</p>
                                            </div>
                                            <input ref={fileInputRef} id="file-upload" type="file" className="hidden" onChange={handleFileChange} accept=".txt,text/plain,.pdf,application/pdf" disabled={totalLoading} />
                                        </label>
                                    )}
                                </div> 
                            )}

                            <div className="mt-6 text-center">
                                <button
                                    onClick={() => handleAnalysis(documentText)}
                                    disabled={totalLoading || !documentText.trim()}
                                    className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:bg-emerald-300 disabled:cursor-not-allowed"
                                >
                                    {totalLoading ? <SpinnerIcon /> : <UploadIcon />}
                                    <span className="ml-2">{loadingText}</span>
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <div className="flex justify-end mb-6">
                                <button onClick={handleReset} className="text-sm text-emerald-600 hover:text-emerald-800 font-medium transition-colors">
                                    Analizar otro documento
                                </button>
                            </div>

                            <div className="space-y-4">
                                <div className="p-2 bg-slate-100 rounded-lg flex flex-wrap gap-2">
                                    <ResultTab mode={ResponseMode.Resumido} label="Resumen Corto"/>
                                    <ResultTab mode={ResponseMode.PuntosClave} label="Puntos Clave"/>
                                    <ResultTab mode={ResponseMode.Completo} label="Resumen Completo"/>
                                </div>
                                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                                    <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
                                        <h3 className="font-semibold text-slate-800">{activeTab} ({displayedLanguage.toUpperCase()})</h3>
                                        <div className="flex items-center gap-4">
                                            <button 
                                                onClick={() => {
                                                    if (displayedLanguage === 'es') {
                                                        if (isEnglishTranslated) {
                                                            setDisplayedLanguage('en');
                                                        } else {
                                                            handleTranslate(activeTab);
                                                        }
                                                    } else {
                                                        setDisplayedLanguage('es');
                                                    }
                                                }}
                                                disabled={isTranslating}
                                                className="inline-flex items-center justify-center px-3 py-1.5 border border-slate-300 text-xs font-medium rounded-md shadow-sm text-slate-700 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:cursor-not-allowed"
                                            >
                                                {isTranslating ? <span className="animate-spin h-4 w-4 border-b-2 border-slate-900 rounded-full"></span> : <TranslateIcon />}
                                                <span className="ml-2">{displayedLanguage === 'es' ? 'Traducir a Inglés' : 'Ver Original (ES)'}</span>
                                            </button>
                                            <button 
                                                onClick={() => handleDownloadText(activeTab)}
                                                disabled={!currentTextToDisplay}
                                                className="inline-flex items-center justify-center p-2 border border-slate-300 text-sm font-medium rounded-md shadow-sm text-slate-700 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
                                                title="Descargar Texto"
                                            >
                                                <DownloadIcon />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="max-h-80 overflow-y-auto prose prose-slate max-w-none whitespace-pre-wrap p-2 border-t border-slate-200" dangerouslySetInnerHTML={{ __html: (currentTextToDisplay || 'Cargando...').replace(/\n/g, '<br />').replace(/\* /g, '&bull; ') }}>
                                    </div>
                                </div>
                                <div className="mt-6 flex flex-col items-center gap-4">
                                    <div className="flex items-center justify-center gap-4 flex-wrap">
                                        <button 
                                            onClick={() => handleGenerateAudio(activeTab, 'es')}
                                            disabled={isGeneratingAudio || !analysisResults?.[activeTab]}
                                            className="inline-flex items-center justify-center px-5 py-2.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:bg-emerald-300"
                                        >
                                            {isGeneratingAudio && <SpinnerIcon />}
                                            <span className="mx-1">{isGeneratingAudio ? (generationProgress || 'Generando...') : 'Audio en Español'}</span>
                                        </button>
                                            <div className="relative group">
                                            <button 
                                                onClick={() => handleGenerateAudio(activeTab, 'en')}
                                                disabled={isGeneratingAudio || !isEnglishTranslated}
                                                className="inline-flex items-center justify-center px-5 py-2.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-teal-600 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 disabled:bg-teal-300 disabled:cursor-not-allowed"
                                            >
                                                {isGeneratingAudio && <SpinnerIcon />}
                                                <span className="mx-1">{isGeneratingAudio ? (generationProgress || 'Generando...') : 'Audio en Inglés'}</span>
                                            </button>
                                            {!isEnglishTranslated && <div className="absolute bottom-full mb-2 w-max px-2 py-1 text-xs text-white bg-slate-700 rounded-md opacity-0 group-hover:opacity-100 transition-opacity">Traduce el texto primero</div>}
                                        </div>
                                    </div>

                                    {audioSrc && (
                                        <div className="w-full max-w-md mt-4 flex items-center gap-2">
                                            <AudioPlayer audioSrc={audioSrc} />
                                            <button
                                                onClick={handleDownloadAudio}
                                                className="p-2 border border-slate-300 rounded-md shadow-sm text-slate-700 bg-white hover:bg-slate-50"
                                                title="Descargar Audio"
                                            >
                                                <DownloadIcon />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                    
                    {warning && (
                        <div className="mt-4 p-4 bg-yellow-100 border border-yellow-400 text-yellow-800 rounded-md" role="alert">
                            <p><span className="font-bold">Aviso:</span> {warning}</p>
                        </div>
                    )}

                    {error && (
                        <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-md" role="alert">
                            <p className="font-bold">Error</p>
                            <p>{error}</p>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default App;