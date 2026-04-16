/**
 * Güvenlik Raporu PDF Şablonu — LaTeX ile
 * Siber güvenlik tarama sonuçlarını PDF'e dönüştürür
 */

import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { VERSION } from './version.js';

export interface SecurityReportData {
  target: string;
  date: string;
  analyst: string;
  findings: Array<{
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
    title: string;
    description: string;
    recommendation: string;
  }>;
  summary: string;
  rawOutput?: string;
}

function escapeLaTeX(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}~^]/g, c => `\\${c}`)
    .replace(/</g, '\\textless{}')
    .replace(/>/g, '\\textgreater{}');
}

function severityColor(sev: string): string {
  const map: Record<string, string> = {
    CRITICAL: '\\textcolor{red}{\\textbf{KRİTİK}}',
    HIGH:     '\\textcolor{orange}{\\textbf{YÜKSEK}}',
    MEDIUM:   '\\textcolor{yellow}{\\textbf{ORTA}}',
    LOW:      '\\textcolor{blue}{\\textbf{DÜŞÜK}}',
    INFO:     '\\textcolor{gray}{\\textbf{BİLGİ}}',
  };
  return map[sev] ?? sev;
}

export function generateLatexReport(data: SecurityReportData): string {
  const findings = data.findings.map((f, i) => `
\\subsection*{Bulgu ${i + 1}: ${escapeLaTeX(f.title)}}
\\begin{tabular}{ll}
\\textbf{Önem Derecesi:} & ${severityColor(f.severity)} \\\\
\\end{tabular}

\\textbf{Açıklama:}\\\\
${escapeLaTeX(f.description)}

\\textbf{Öneri:}\\\\
${escapeLaTeX(f.recommendation)}

\\hrule
`).join('\n');

  const rawSection = data.rawOutput ? `
\\section{Ham Tarama Çıktısı}
\\begin{verbatim}
${data.rawOutput.slice(0, 3000)}
\\end{verbatim}
` : '';

  return `\\documentclass[12pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[turkish]{babel}
\\usepackage{xcolor}
\\usepackage{geometry}
\\usepackage{fancyhdr}
\\usepackage{booktabs}
\\usepackage{hyperref}
\\usepackage{titlesec}
\\usepackage{mdframed}

\\geometry{margin=2.5cm}
\\definecolor{sethblue}{RGB}{0,82,155}
\\definecolor{critred}{RGB}{200,0,0}

\\pagestyle{fancy}
\\fancyhf{}
\\rhead{\\textcolor{sethblue}{\\textbf{SETH Güvenlik Raporu}}}
\\lhead{${escapeLaTeX(data.target)}}
\\rfoot{Sayfa \\thepage}
\\lfoot{${escapeLaTeX(data.date)}}

\\titleformat{\\section}{\\large\\bfseries\\color{sethblue}}{}{0em}{}[\\titlerule]

\\begin{document}

\\begin{titlepage}
\\centering
\\vspace*{2cm}
{\\Huge\\bfseries\\color{sethblue} SİBER GÜVENLİK\\\\[0.5em]TARAMA RAPORU}\\\\[2cm]
\\begin{tabular}{rl}
\\textbf{Hedef:} & ${escapeLaTeX(data.target)} \\\\[0.3em]
\\textbf{Tarih:} & ${escapeLaTeX(data.date)} \\\\[0.3em]
\\textbf{Analist:} & ${escapeLaTeX(data.analyst)} \\\\[0.3em]
\\textbf{Araç:} & SETH v${VERSION} \\\\
\\end{tabular}
\\vfill
{\\small\\color{gray} Bu rapor SETH yapay zeka ajanı tarafından otomatik oluşturulmuştur.}
\\end{titlepage}

\\tableofcontents
\\newpage

\\section{Yönetici Özeti}
${escapeLaTeX(data.summary)}

\\section{Bulgular}
${findings}

${rawSection}

\\section{Sorumluluk Reddi}
Bu rapor yalnızca yetkili güvenlik testleri kapsamında hazırlanmıştır.
Raporun içeriği gizlidir ve yalnızca yetkili kişilerle paylaşılmalıdır.

\\end{document}
`;
}

export async function exportSecurityReport(
  reportText: string,
  outputDir: string = process.cwd()
): Promise<string | null> {
  // Rapor metninden basit veri çıkar
  const date = new Date().toLocaleDateString('tr-TR');
  const data: SecurityReportData = {
    target: extractTarget(reportText),
    date,
    analyst: 'SETH Otomatik Tarama',
    summary: extractSummary(reportText),
    findings: extractFindings(reportText),
    rawOutput: reportText.slice(0, 5000),
  };

  const latex = generateLatexReport(data);
  const texFile = join(outputDir, `guvenlik-raporu-${Date.now()}.tex`);
  const pdfFile = texFile.replace('.tex', '.pdf');

  writeFileSync(texFile, latex, 'utf8');

  // pdflatex varsa PDF oluştur
  try {
    execSync(`pdflatex -interaction=nonstopmode -output-directory="${outputDir}" "${texFile}"`, {
      stdio: 'ignore', timeout: 30000
    });
    return pdfFile;
  } catch {
    // pdflatex yoksa sadece .tex döndür
    return texFile;
  }
}

function extractTarget(text: string): string {
  const m = text.match(/(?:hedef|target|domain|site)[:\s]+([a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/i);
  return m?.[1] ?? 'Bilinmiyor';
}

function extractSummary(text: string): string {
  const lines = text.split('\n').slice(0, 5).join(' ');
  return lines.slice(0, 500) || 'Güvenlik taraması tamamlandı.';
}

function extractFindings(text: string): SecurityReportData['findings'] {
  const findings: SecurityReportData['findings'] = [];
  const patterns = [
    { re: /CRITICAL|KRİTİK/gi, sev: 'CRITICAL' as const },
    { re: /HIGH|YÜKSEK/gi, sev: 'HIGH' as const },
    { re: /MEDIUM|ORTA/gi, sev: 'MEDIUM' as const },
    { re: /LOW|DÜŞÜK/gi, sev: 'LOW' as const },
  ];
  for (const { re, sev } of patterns) {
    const matches = text.match(re);
    if (matches) {
      findings.push({
        severity: sev,
        title: `${sev} seviyeli bulgular (${matches.length} adet)`,
        description: `Tarama sırasında ${matches.length} adet ${sev} seviyeli sorun tespit edildi.`,
        recommendation: 'İlgili güvenlik açıklarını en kısa sürede kapatın.',
      });
    }
  }
  if (findings.length === 0) {
    findings.push({
      severity: 'INFO',
      title: 'Tarama Tamamlandı',
      description: 'Tarama tamamlandı, kritik bulgu tespit edilmedi.',
      recommendation: 'Düzenli tarama yapmaya devam edin.',
    });
  }
  return findings;
}
