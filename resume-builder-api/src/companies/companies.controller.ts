import { Controller, Get, Query } from '@nestjs/common';

const CURATED_COMPANIES = [
  'Accenture',
  'Amazon',
  'Apple',
  'Capgemini',
  'Citi Corp',
  'Deloitte',
  'Ernst & Young',
  'Google',
  'HCL Technologies',
  'IBM',
  'Infosys Ltd',
  'KPMG',
  'Meta',
  'Microsoft',
  'One Network Enterprises',
  'Oracle',
  'PwC',
  'Tata Consultancy Services',
  'Wipro',
];

@Controller('companies')
export class CompaniesController {
  @Get('suggest')
  suggest(@Query('q') query = '') {
    return {
      query: String(query || '').trim(),
      suggestions: suggestCompanyNames(query),
    };
  }
}

export function suggestCompanyNames(query: string, limit = 10) {
  const clean = String(query || '').trim().toLowerCase();
  if (!clean) {
    return CURATED_COMPANIES.slice(0, limit);
  }
  return CURATED_COMPANIES
    .filter((name) => name.toLowerCase().includes(clean))
    .sort((a, b) => {
      const aStarts = a.toLowerCase().startsWith(clean);
      const bStarts = b.toLowerCase().startsWith(clean);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      return a.localeCompare(b);
    })
    .slice(0, limit);
}
