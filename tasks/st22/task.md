# INTENT
This task checks the SAP system for ABAP short dumps and system crashes. 
Trigger: "check ST22", "scan for short dumps", "check system errors", or "read the crash logs".

# TYPE
TCODE

# TARGET
ST22

# PARAMETERS
The AI must extract or infer the following parameters from the conversation before executing:
- `startDate`: (Date) The start date for the search. If the user doesn't specify, default to "Yesterday" based on the current date. Format as MM/DD/YYYY.
- `endDate`: (Date) The end date for the search. If the user doesn't specify, default to "Today" based on the current date. Format as MM/DD/YYYY.
- `userName`: (String) The specific SAP user to check. If the user says "system wide", "everyone", or simply doesn't specify a user, default to "*".