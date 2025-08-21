import frappe  # type: ignore
from frappe.utils import flt  # type: ignore

def execute(filters=None):
    if not filters:
        return [], []

    if filters.get("supplier"):
        return get_detailed_view(filters)
    else:
        return get_summary_view(filters)


def get_summary_view(filters):
    data = []
    columns = [
        {"label": "Supplier", "fieldname": "supplier_link", "fieldtype": "Data", "width": 400},
        {"label": "Total Debit", "fieldname": "total_debit", "fieldtype": "Float", "width": 200},
        {"label": "Total Credit", "fieldname": "total_credit", "fieldtype": "Float", "width": 200},
        {"label": "Balance", "fieldname": "balance", "fieldtype": "Float", "width": 200},
    ]

    result = frappe.db.sql("""
        SELECT
            party AS supplier,
            SUM(debit) AS total_debit,
            SUM(credit) AS total_credit,
            ABS(SUM(debit - credit)) AS balance
        FROM `tabGL Entry`
        WHERE posting_date BETWEEN %(from_date)s AND %(to_date)s
        AND party_type = 'Supplier'
        GROUP BY party
    """, filters, as_dict=True)

    for row in result:
        row["supplier_link"] = row["supplier"]
        data.append(row)

    return columns, data


def clean_account(account_name):
    import re
    name_only = re.sub(r"^\d+\s*-\s*", "", account_name)
    aliases = {
        "Withholding Tax": "WHT 5%",
        "Withholding VAT": "WHVAT 2%",
        "VAT Payable": "VAT 16%",
        "Input VAT": "VAT 16%",
        "Ksh Supliers Control Account": "Accounts Payable"
    }
    return aliases.get(name_only.strip(), name_only.strip())


def get_detailed_view(filters):
    supplier = filters.get("supplier")
    from_date = filters.get("from_date")
    to_date = filters.get("to_date")
    running_balance = 0
    data = []

    invoices = frappe.db.sql("""
        SELECT name, posting_date
        FROM `tabPurchase Invoice`
        WHERE supplier = %(supplier)s
        AND posting_date BETWEEN %(from_date)s AND %(to_date)s
        ORDER BY posting_date, name
    """, filters, as_dict=True)

    for inv in invoices:
        voucher_no = inv.name
        posting_date = inv.posting_date

        # Net amount (excluding VAT)
        items = frappe.db.sql("""
            SELECT expense_account AS account, SUM(amount) AS total
            FROM `tabPurchase Invoice Item`
            WHERE parent = %s
            GROUP BY expense_account
        """, voucher_no, as_dict=True)

        for item in items:
            running_balance += flt(item.total)
            data.append({
                "posting_date": posting_date,
                "voucher_no": voucher_no,
                "voucher_type": "Purchase Invoice",
                "account": clean_account(item.account),
                "debit": item.total,
                "credit": 0,
                "balance": running_balance
            })

        # VAT amounts
        taxes = frappe.db.sql("""
            SELECT account_head, tax_amount
            FROM `tabPurchase Taxes and Charges`
            WHERE parent = %s
        """, voucher_no, as_dict=True)

        for tax in taxes:
            running_balance += flt(tax.tax_amount)
            data.append({
                "posting_date": posting_date,
                "voucher_no": voucher_no,
                "voucher_type": "Purchase Invoice",
                "account": clean_account(tax.account_head),
                "debit": tax.tax_amount,
                "credit": 0,
                "balance": running_balance
            })

        # Withholding JE
        je_wht = frappe.db.sql("""
            SELECT je.name AS voucher_no, je.posting_date, jea.account, jea.debit, jea.credit
            FROM `tabJournal Entry` je
            JOIN `tabJournal Entry Account` jea ON je.name = jea.parent
            WHERE (je.remark LIKE %(ref)s OR je.user_remark LIKE %(ref)s)
            AND jea.account LIKE '%%Withholding%%'
        """, {"ref": f"%{voucher_no}%"}, as_dict=True)

        for je in je_wht:
            running_balance += flt(je.debit) - flt(je.credit)
            data.append({
                "posting_date": je.posting_date,
                "voucher_no": je.voucher_no,
                "voucher_type": "Journal Entry",
                "account": clean_account(je.account),
                "debit": je.debit,
                "credit": je.credit,
                "balance": running_balance
            })

        # Payment Entry
        payments = frappe.db.sql("""
            SELECT pe.name AS voucher_no, pe.posting_date, gle.account, gle.debit, gle.credit
            FROM `tabPayment Entry Reference` per
            JOIN `tabPayment Entry` pe ON pe.name = per.parent
            JOIN `tabGL Entry` gle ON gle.voucher_no = pe.name
            WHERE per.reference_doctype = 'Purchase Invoice'
            AND per.reference_name = %s
            AND (gle.account LIKE '%%Bank%%' OR gle.account LIKE '%%Cash%%')
        """, (voucher_no,), as_dict=True)

        for pay in payments:
            running_balance += flt(pay.debit) - flt(pay.credit)
            data.append({
                "posting_date": pay.posting_date,
                "voucher_no": pay.voucher_no,
                "voucher_type": "Payment Entry",
                "account": clean_account(pay.account),
                "debit": pay.debit,
                "credit": pay.credit,
                "balance": running_balance
            })

        # KRA Journal Entry
        kra_pays = frappe.db.sql("""
            SELECT je.name AS voucher_no, je.posting_date, jea.account, jea.debit, jea.credit
            FROM `tabJournal Entry` je
            JOIN `tabJournal Entry Account` jea ON je.name = jea.parent
            WHERE (je.remark LIKE %(ref)s OR je.user_remark LIKE %(ref)s)
            AND (jea.account LIKE '%%KRA%%' OR jea.account LIKE '%%Bank%%')
        """, {"ref": f"%{voucher_no}%"}, as_dict=True)

        for kra in kra_pays:
            running_balance += flt(kra.debit) - flt(kra.credit)
            data.append({
                "posting_date": kra.posting_date,
                "voucher_no": kra.voucher_no,
                "voucher_type": "Journal Entry",
                "account": clean_account(kra.account),
                "debit": kra.debit,
                "credit": kra.credit,
                "balance": running_balance
            })

    columns = [
        {"label": "Posting Date", "fieldname": "posting_date", "fieldtype": "Date", "width": 150},
        {"label": "Invoice No", "fieldname": "voucher_no", "fieldtype": "Dynamic Link", "options": "voucher_type", "width": 250},
        {"label": "Account", "fieldname": "account", "fieldtype": "Data", "width": 300},
        {"label": "Debit", "fieldname": "debit", "fieldtype": "Float", "width": 180},
        {"label": "Credit", "fieldname": "credit", "fieldtype": "Float", "width": 180},
        {"label": "Balance", "fieldname": "balance", "fieldtype": "Float", "width": 200},
    ]

    return columns, data
