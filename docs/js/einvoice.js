// E-Rechnung im Format ZUGFeRD / Factur-X, Profil EN 16931 (UN/CEFACT CII).
import { EINHEITEN } from './logic.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const betrag = (cent) => (cent / 100).toFixed(2);
const d102 = (iso) => iso.replace(/-/g, '');
const menge = (n) => String(Math.round(n * 10000) / 10000);

function adresse(a) {
  return `<ram:PostalTradeAddress>
        <ram:PostcodeCode>${esc(a.plz)}</ram:PostcodeCode>
        <ram:LineOne>${esc(a.strasse)}</ram:LineOne>
        <ram:CityName>${esc(a.ort)}</ram:CityName>
        <ram:CountryID>${esc(a.land || 'DE')}</ram:CountryID>
      </ram:PostalTradeAddress>`;
}

export function erzeugeXml(inv, s) {
  const f = s.firma;
  const k = inv.kunde;
  const sum = inv.summen;
  const typeCode = '380';

  const zeilen = sum.zeilen.map((z, i) => `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${esc(z.name)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>${betrag(z.preisCent)}</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="${(EINHEITEN[z.einheit] || EINHEITEN.Stk).code}">${menge(z.menge)}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>S</ram:CategoryCode>
          <ram:RateApplicablePercent>${z.steuersatz}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>${z.zeilenRabatt ? `
        <ram:SpecifiedTradeAllowanceCharge>
          <ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator>
          <ram:ActualAmount>${betrag(z.zeilenRabatt)}</ram:ActualAmount>
          <ram:Reason>Rabatt ${z.rabattProzent} %</ram:Reason>
        </ram:SpecifiedTradeAllowanceCharge>` : ''}
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${betrag(z.zeileNetto)}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`).join('');

  const steuern = sum.steuern.map((t) => `
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${betrag(t.steuer)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>${betrag(t.netto)}</ram:BasisAmount>
        <ram:CategoryCode>S</ram:CategoryCode>
        <ram:RateApplicablePercent>${t.satz}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`).join('');

  const rabatte = sum.steuern.filter((t) => t.rabatt).map((t) => `
      <ram:SpecifiedTradeAllowanceCharge>
        <ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator>
        <ram:ActualAmount>${betrag(t.rabatt)}</ram:ActualAmount>
        <ram:Reason>Rabatt</ram:Reason>
        <ram:CategoryTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>S</ram:CategoryCode>
          <ram:RateApplicablePercent>${t.satz}</ram:RateApplicablePercent>
        </ram:CategoryTradeTax>
      </ram:SpecifiedTradeAllowanceCharge>`).join('');

  const bar = inv.zahlart === 'bar';
  const zahlung = bar
    ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>10</ram:TypeCode></ram:SpecifiedTradeSettlementPaymentMeans>`
    : `<ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>58</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${esc(f.iban.replace(/\s/g, ''))}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>
      </ram:SpecifiedTradeSettlementPaymentMeans>`;

  const steuerReg = [
    f.ustid ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(f.ustid)}</ram:ID></ram:SpecifiedTaxRegistration>` : '',
    f.steuernummer ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${esc(f.steuernummer)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''
  ].join('');

  const vorausbezahlt = bar ? sum.brutto : 0;
  const bezug = inv.bezugNr ? `
      <ram:InvoiceReferencedDocument>
        <ram:IssuerAssignedID>${esc(inv.bezugNr)}</ram:IssuerAssignedID>${inv.bezugDatum ? `
        <ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${d102(inv.bezugDatum)}</qdt:DateTimeString></ram:FormattedIssueDateTime>` : ''}
      </ram:InvoiceReferencedDocument>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${esc(inv.nr)}</ram:ID>
    <ram:TypeCode>${typeCode}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${d102(inv.datum)}</udt:DateTimeString></ram:IssueDateTime>${inv.pferde && inv.pferde.length ? `
    <ram:IncludedNote><ram:Content>Pferde: ${esc(inv.pferde.join(', '))}</ram:Content></ram:IncludedNote>` : ''}${inv.typ === 'storno' ? `
    <ram:IncludedNote><ram:Content>Stornorechnung zu ${esc(inv.bezugNr)}</ram:Content></ram:IncludedNote>` : ''}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>${zeilen}
    <ram:ApplicableHeaderTradeAgreement>${k.leitwegId ? `
      <ram:BuyerReference>${esc(k.leitwegId)}</ram:BuyerReference>` : ''}
      <ram:SellerTradeParty>
        <ram:Name>${esc(f.name)}</ram:Name>${f.telefon || f.email ? `
        <ram:DefinedTradeContact>
          <ram:PersonName>${esc(f.inhaber || f.name)}</ram:PersonName>${f.telefon ? `
          <ram:TelephoneUniversalCommunication><ram:CompleteNumber>${esc(f.telefon)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>` : ''}${f.email ? `
          <ram:EmailURIUniversalCommunication><ram:URIID>${esc(f.email)}</ram:URIID></ram:EmailURIUniversalCommunication>` : ''}
        </ram:DefinedTradeContact>` : ''}
        ${adresse(f)}${f.email ? `
        <ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(f.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
        ${steuerReg}
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${esc(k.name)}</ram:Name>
        ${adresse(k)}${k.email ? `
        <ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(k.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}${k.ustid ? `
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(k.ustid)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent>
        <ram:OccurrenceDateTime><udt:DateTimeString format="102">${d102(inv.leistungsdatum)}</udt:DateTimeString></ram:OccurrenceDateTime>
      </ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>${!bar ? `
      <ram:PaymentReference>${esc(inv.nr)}</ram:PaymentReference>` : ''}
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      ${zahlung}${steuern}${rabatte}
      <ram:SpecifiedTradePaymentTerms>${bar ? `
        <ram:Description>Betrag bar erhalten</ram:Description>` : `
        <ram:Description>Zahlbar bis ${inv.faelligAm.split('-').reverse().join('.')} ohne Abzug</ram:Description>
        <ram:DueDateDateTime><udt:DateTimeString format="102">${d102(inv.faelligAm)}</udt:DateTimeString></ram:DueDateDateTime>`}
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${betrag(sum.summePositionen)}</ram:LineTotalAmount>
        <ram:ChargeTotalAmount>0.00</ram:ChargeTotalAmount>
        <ram:AllowanceTotalAmount>${betrag(sum.gesamtRabatt)}</ram:AllowanceTotalAmount>
        <ram:TaxBasisTotalAmount>${betrag(sum.netto)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${betrag(sum.steuer)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${betrag(sum.brutto)}</ram:GrandTotalAmount>
        <ram:TotalPrepaidAmount>${betrag(vorausbezahlt)}</ram:TotalPrepaidAmount>
        <ram:DuePayableAmount>${betrag(sum.brutto - vorausbezahlt)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>${bezug}
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}
