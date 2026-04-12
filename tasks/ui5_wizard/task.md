# INTENT
This task runs the UI5 Product Creation Wizard. It handles creating new product entries, filling out mobile or laptop specifications, and submitting the wizard form. Use this task when the user asks to "run the wizard", "create a product", or "test the UI5 app".

# TYPE
UI5

# TARGET
http://192.168.1.251:8000/sap/bc/ui5_ui5/sap/zwizard_test/index.html?sap-client=001

# PAYLOAD
- productType=Mobile
- productName=TEST03
- productWeight=123